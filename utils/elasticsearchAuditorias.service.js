// Sincronizacion de auditorias hacia Elasticsearch. MySQL sigue siendo la fuente principal.
const { getAuditDocumentById } = require('./auditoriaDocument.service');
const { query } = require('./db');
const {
  getElasticsearchClient,
  getElasticsearchConfig,
  resetElasticsearchClient
} = require('./elasticsearchClient');

const REQUEST_TIMEOUT_MS = 3000;
const BULK_REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_REINDEX_BATCH_SIZE = 100;
let auditoriasIndexReady = false;

function parseAuditoriaId(idAuditoria) {
  const auditoriaId = Number(idAuditoria);
  if (!Number.isInteger(auditoriaId) || auditoriaId <= 0) {
    const error = new Error('id_auditoria invalido para sincronizacion Elasticsearch.');
    error.code = 'ELASTIC_AUDITORIA_ID_INVALIDO';
    throw error;
  }

  return auditoriaId;
}

function getRequestOptions(signal, timeoutMs = REQUEST_TIMEOUT_MS) {
  return {
    requestTimeout: timeoutMs,
    maxRetries: 0,
    signal
  };
}

function runWithTimeout(requestFactory, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      const error = new Error(`Timeout de Elasticsearch despues de ${timeoutMs}ms`);
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);

    timeoutId.unref?.();
  });

  const requestPromise = Promise.resolve().then(() => requestFactory(controller.signal));

  return Promise.race([
    requestPromise,
    timeoutPromise
  ]).finally(() => clearTimeout(timeoutId));
}

function buildIndexMappings() {
  return {
    dynamic: true,
    properties: {
      id_auditoria: { type: 'integer' },
      id_estado: { type: 'integer' },
      estado_auditoria: { type: 'keyword' },
      estado_nombre: { type: 'keyword' },
      id_cliente: { type: 'integer' },
      id_empresa_auditora: { type: 'integer' },
      id_solicitud_pago: { type: 'integer' },
      monto: { type: 'double' },
      fecha_inicio: { type: 'date', format: 'strict_date_optional_time||yyyy-MM-dd' },
      creada_en: { type: 'date' },
      estado_actualizado_en: { type: 'date' },
      objetivo: { type: 'text' },
      reporte_final: { type: 'object', dynamic: true },
      participantes: { type: 'object', dynamic: true },
      modulos: { type: 'object', dynamic: true },
      cliente: { type: 'object', dynamic: true },
      empresa_auditora: { type: 'object', dynamic: true },
      empresa_cliente: { type: 'object', dynamic: true },
      solicitud_pago: { type: 'object', dynamic: true }
    }
  };
}

async function ensureAuditoriasIndex(client, indexName) {
  if (auditoriasIndexReady) return;

  const exists = await runWithTimeout((signal) =>
    client.indices.exists({ index: indexName }, getRequestOptions(signal))
  );

  if (!exists) {
    await runWithTimeout((signal) =>
      client.indices.create({
        index: indexName,
        mappings: buildIndexMappings()
      }, getRequestOptions(signal))
    );
  }

  auditoriasIndexReady = true;
}

function isNotFoundError(error) {
  return Number(error?.statusCode || error?.meta?.statusCode) === 404;
}

function logSyncError(action, idAuditoria, error) {
  // Mejora futura: persistir estos fallos en Outbox o cola de reintentos.
  console.error('[Elasticsearch][Auditorias] Error de sincronizacion:', {
    action,
    id_auditoria: idAuditoria,
    name: error?.name,
    code: error?.code,
    statusCode: error?.statusCode || error?.meta?.statusCode,
    message: error?.message
  });
}

function normalizeBatchSize(batchSize) {
  const value = Number(batchSize);
  if (!Number.isInteger(value) || value <= 0) return DEFAULT_REINDEX_BATCH_SIZE;
  return Math.min(value, 500);
}

function pushError(errors, error) {
  errors.push(error);

  if (errors.length > 20) {
    errors.shift();
  }
}

function summarizeError(error) {
  return {
    name: error?.name,
    code: error?.code,
    statusCode: error?.statusCode || error?.meta?.statusCode,
    message: error?.message
  };
}

async function prepareSync(action, idAuditoria, options = {}) {
  const auditoriaId = parseAuditoriaId(idAuditoria);
  const config = getElasticsearchConfig();

  if (!config.enabled) {
    return {
      skipped: true,
      reason: 'elasticsearch_disabled',
      action,
      id_auditoria: auditoriaId
    };
  }

  const document = await getAuditDocumentById(auditoriaId);
  if (!document && options.requireDocument !== false) {
    return {
      skipped: true,
      reason: 'auditoria_not_found',
      action,
      id_auditoria: auditoriaId
    };
  }

  const client = getElasticsearchClient();
  if (!client) {
    return {
      skipped: true,
      reason: 'elasticsearch_client_unavailable',
      action,
      id_auditoria: auditoriaId
    };
  }

  return {
    skipped: false,
    action,
    id_auditoria: auditoriaId,
    index: config.indexAuditorias,
    client,
    document
  };
}

async function getAllAuditoriaIds() {
  const rows = await query(
    `SELECT id_auditoria
     FROM auditorias
     ORDER BY id_auditoria ASC;`
  );

  return rows.map((row) => Number(row.id_auditoria)).filter((id) => Number.isInteger(id) && id > 0);
}

async function buildDocumentsForIds(ids) {
  const results = await Promise.all(ids.map(async (idAuditoria) => {
    try {
      const document = await getAuditDocumentById(idAuditoria);
      if (!document) {
        return {
          ok: false,
          id_auditoria: idAuditoria,
          error: {
            message: 'Auditoria no encontrada al construir documento.'
          }
        };
      }

      return {
        ok: true,
        id_auditoria: idAuditoria,
        document
      };
    } catch (error) {
      return {
        ok: false,
        id_auditoria: idAuditoria,
        error: summarizeError(error)
      };
    }
  }));

  return {
    documents: results.filter((item) => item.ok).map((item) => item.document),
    failures: results.filter((item) => !item.ok)
  };
}

function buildBulkOperations(documents) {
  return documents.flatMap((document) => [
    {
      index: {
        _id: String(document.id_auditoria)
      }
    },
    document
  ]);
}

function summarizeBulkResponse(response, documents) {
  const items = Array.isArray(response?.items) ? response.items : [];
  const failures = [];
  let successful = 0;

  items.forEach((item, index) => {
    const result = item.index || item.create || item.update || item.delete || {};
    const status = Number(result.status);
    const idAuditoria = Number(result._id || documents[index]?.id_auditoria);

    if (status >= 200 && status < 300 && !result.error) {
      successful += 1;
      return;
    }

    failures.push({
      id_auditoria: idAuditoria,
      status,
      error: result.error || { message: 'Error desconocido en Bulk API.' }
    });
  });

  if (!items.length && documents.length > 0) {
    return {
      successful: response?.errors ? 0 : documents.length,
      failures
    };
  }

  return {
    successful,
    failures
  };
}

async function bulkIndexAuditorias(documents, options = {}) {
  if (!documents.length) {
    return {
      sent: 0,
      successful: 0,
      failures: []
    };
  }

  const client = options.client || getElasticsearchClient();
  const index = options.index || getElasticsearchConfig().indexAuditorias;

  const response = await runWithTimeout((signal) =>
    client.bulk({
      index,
      operations: buildBulkOperations(documents)
    }, getRequestOptions(signal, BULK_REQUEST_TIMEOUT_MS)),
    BULK_REQUEST_TIMEOUT_MS
  );

  const summary = summarizeBulkResponse(response, documents);

  return {
    sent: documents.length,
    successful: summary.successful,
    failures: summary.failures
  };
}

async function reindexAuditorias(options = {}) {
  const action = 'reindexAuditorias';
  const batchSize = normalizeBatchSize(options.batchSize || process.env.ELASTICSEARCH_REINDEX_BATCH_SIZE);
  const config = getElasticsearchConfig();
  const startedAt = new Date();
  const result = {
    action,
    enabled: config.enabled,
    index: config.indexAuditorias,
    batch_size: batchSize,
    started_at: startedAt.toISOString(),
    finished_at: null,
    total_leidas_mysql: 0,
    total_enviadas_elasticsearch: 0,
    total_exitosas: 0,
    total_fallidas: 0,
    errores: []
  };

  try {
    const ids = await getAllAuditoriaIds();
    result.total_leidas_mysql = ids.length;

    if (!config.enabled) {
      result.finished_at = new Date().toISOString();
      result.skipped = true;
      result.reason = 'elasticsearch_disabled';
      return result;
    }

    let client = getElasticsearchClient();
    if (!client) {
      result.finished_at = new Date().toISOString();
      result.skipped = true;
      result.reason = 'elasticsearch_client_unavailable';
      return result;
    }

    await ensureAuditoriasIndex(client, config.indexAuditorias);

    for (let start = 0; start < ids.length; start += batchSize) {
      const batchIds = ids.slice(start, start + batchSize);
      const built = await buildDocumentsForIds(batchIds);

      built.failures.forEach((failure) => {
        result.total_fallidas += 1;
        pushError(result.errores, {
          stage: 'builder',
          id_auditoria: failure.id_auditoria,
          error: failure.error
        });
      });

      try {
        const bulkResult = await bulkIndexAuditorias(built.documents, {
          client,
          index: config.indexAuditorias
        });

        result.total_enviadas_elasticsearch += bulkResult.sent;
        result.total_exitosas += bulkResult.successful;
        result.total_fallidas += bulkResult.failures.length;

        bulkResult.failures.forEach((failure) => {
          pushError(result.errores, {
            stage: 'bulk',
            id_auditoria: failure.id_auditoria,
            status: failure.status,
            error: failure.error
          });
        });
      } catch (error) {
        resetElasticsearchClient();
        client = getElasticsearchClient();
        result.total_enviadas_elasticsearch += built.documents.length;
        result.total_fallidas += built.documents.length;
        pushError(result.errores, {
          stage: 'bulk_request',
          ids: batchIds,
          error: summarizeError(error)
        });
      }
    }

    result.finished_at = new Date().toISOString();
    return result;
  } catch (error) {
    resetElasticsearchClient();
    result.finished_at = new Date().toISOString();
    result.failed = true;
    result.total_fallidas = Math.max(result.total_fallidas, result.total_leidas_mysql - result.total_exitosas);
    pushError(result.errores, {
      stage: 'reindex',
      error: summarizeError(error)
    });
    return result;
  }
}

async function indexAuditoria(idAuditoria) {
  const action = 'indexAuditoria';

  try {
    const sync = await prepareSync(action, idAuditoria);
    if (sync.skipped) return sync;

    await ensureAuditoriasIndex(sync.client, sync.index);
    await runWithTimeout((signal) =>
      sync.client.index({
        index: sync.index,
        id: String(sync.id_auditoria),
        document: sync.document
      }, getRequestOptions(signal))
    );

    return {
      synced: true,
      action,
      index: sync.index,
      id_auditoria: sync.id_auditoria
    };
  } catch (error) {
    resetElasticsearchClient();
    logSyncError(action, idAuditoria, error);
    return {
      synced: false,
      action,
      id_auditoria: Number(idAuditoria),
      error: error?.message
    };
  }
}

async function updateAuditoria(idAuditoria) {
  const action = 'updateAuditoria';

  try {
    const sync = await prepareSync(action, idAuditoria);
    if (sync.skipped) return sync;

    await ensureAuditoriasIndex(sync.client, sync.index);
    await runWithTimeout((signal) =>
      sync.client.update({
        index: sync.index,
        id: String(sync.id_auditoria),
        doc: sync.document,
        doc_as_upsert: true
      }, getRequestOptions(signal))
    );

    return {
      synced: true,
      action,
      index: sync.index,
      id_auditoria: sync.id_auditoria
    };
  } catch (error) {
    resetElasticsearchClient();
    logSyncError(action, idAuditoria, error);
    return {
      synced: false,
      action,
      id_auditoria: Number(idAuditoria),
      error: error?.message
    };
  }
}

async function syncAuditoria(idAuditoria) {
  return updateAuditoria(idAuditoria);
}

async function deleteAuditoria(idAuditoria) {
  const action = 'deleteAuditoria';

  try {
    const sync = await prepareSync(action, idAuditoria, { requireDocument: false });
    if (sync.skipped) return sync;

    const exists = await runWithTimeout((signal) =>
      sync.client.indices.exists({ index: sync.index }, getRequestOptions(signal))
    );

    if (!exists) {
      return {
        skipped: true,
        reason: 'index_not_found',
        action,
        id_auditoria: sync.id_auditoria
      };
    }

    await runWithTimeout((signal) =>
      sync.client.delete({
        index: sync.index,
        id: String(sync.id_auditoria)
      }, getRequestOptions(signal))
    );

    return {
      synced: true,
      action,
      index: sync.index,
      id_auditoria: sync.id_auditoria
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        synced: true,
        action,
        id_auditoria: Number(idAuditoria),
        alreadyDeleted: true
      };
    }

    resetElasticsearchClient();
    logSyncError(action, idAuditoria, error);
    return {
      synced: false,
      action,
      id_auditoria: Number(idAuditoria),
      error: error?.message
    };
  }
}

module.exports = {
  indexAuditoria,
  updateAuditoria,
  deleteAuditoria,
  syncAuditoria,
  bulkIndexAuditorias,
  reindexAuditorias
};
