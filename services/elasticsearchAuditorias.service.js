const {
  getElasticsearchClient,
  getElasticsearchNode,
  getAuditoriasIndex,
  isElasticsearchEnabled,
  safeElasticOperation
} = require('../utils/elasticsearch');

function getEstadoAuditoriaNombre(idEstado) {
  switch (Number(idEstado)) {
    case 1:
      return 'CREADA';
    case 2:
      return 'EN_PROCESO';
    case 3:
      return 'FINALIZADA';
    default:
      return 'DESCONOCIDO';
  }
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildAuditoriaDocument(auditoria = {}) {
  const idEstado = toNumberOrNull(auditoria.id_estado) || 0;
  const estadoNombre = getEstadoAuditoriaNombre(idEstado);

  const document = {
    id_auditoria: toNumberOrNull(auditoria.id_auditoria),
    id_estado: idEstado,
    estado_auditoria: estadoNombre,
    estado_nombre: estadoNombre,
    id_cliente: toNumberOrNull(auditoria.id_cliente),
    id_empresa_auditora: toNumberOrNull(auditoria.id_empresa_auditora),
    id_solicitud_pago: toNumberOrNull(auditoria.id_solicitud_pago),
    monto: toNumberOrNull(auditoria.monto),
    fecha_inicio: auditoria.fecha_inicio || null,
    creada_en: auditoria.creada_en || auditoria.creado_en || null,
    estado_actualizado_en: auditoria.estado_actualizado_en || new Date().toISOString()
  };

  if (auditoria.id_empresa_cliente !== undefined) {
    document.id_empresa_cliente = toNumberOrNull(auditoria.id_empresa_cliente);
  }

  if (auditoria.objetivo !== undefined) {
    document.objetivo = auditoria.objetivo || null;
  }

  if (auditoria.activo !== undefined) {
    document.activo = Boolean(auditoria.activo);
  }

  return document;
}


async function ensureAuditoriasIndex() {
  return safeElasticOperation('ensureAuditoriasIndex', async (client) => {
    const index = getAuditoriasIndex();
    const exists = await client.indices.exists({ index });

    if (!exists) {
      return client.indices.create({
        index,
        mappings: {
          properties: {
            id_auditoria: { type: 'integer' },
            id_estado: { type: 'integer' },
            estado_auditoria: { type: 'keyword' },
            estado_nombre: { type: 'keyword' },
            id_cliente: { type: 'integer' },
            id_empresa_auditora: { type: 'integer' },
            id_empresa_cliente: { type: 'integer' },
            id_solicitud_pago: { type: 'integer' },
            monto: { type: 'double' },
            fecha_inicio: { type: 'date', ignore_malformed: true },
            creada_en: { type: 'date', ignore_malformed: true },
            estado_actualizado_en: { type: 'date', ignore_malformed: true },
            objetivo: { type: 'text' },
            activo: { type: 'boolean' },
            eliminado_en: { type: 'date', ignore_malformed: true }
          }
        }
      });
    }

    // Compatibilidad con indices creados dinamicamente antes del mapping keyword.
    return client.indices.putMapping({
      index,
      properties: {
        estado_auditoria: { type: 'text', fielddata: true, fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
        estado_nombre: { type: 'keyword' }
      }
    });
  });
}

async function indexAuditoria(auditoria) {
  const document = buildAuditoriaDocument(auditoria);
  if (!document.id_auditoria) {
    return { enabled: isElasticsearchEnabled(), ok: false, skipped: true };
  }

  await ensureAuditoriasIndex();

  return safeElasticOperation('indexAuditoria', (client) =>
    client.update({
      index: getAuditoriasIndex(),
      id: String(document.id_auditoria),
      doc: document,
      doc_as_upsert: true
    })
  );
}

async function updateAuditoria(auditoria) {
  return indexAuditoria(auditoria);
}

async function updateEstadoAuditoria(idAuditoria, idEstado) {
  const estadoNombre = getEstadoAuditoriaNombre(idEstado);
  const estadoActualizadoEn = new Date().toISOString();

  await ensureAuditoriasIndex();

  return safeElasticOperation('updateEstadoAuditoria', (client) =>
    client.update({
      index: getAuditoriasIndex(),
      id: String(idAuditoria),
      doc: {
        id_auditoria: Number(idAuditoria),
        id_estado: Number(idEstado),
        estado_auditoria: estadoNombre,
        estado_nombre: estadoNombre,
        estado_actualizado_en: estadoActualizadoEn
      },
      doc_as_upsert: true
    })
  );
}

async function deleteAuditoria(idAuditoria) {
  return safeElasticOperation('deleteAuditoria', async (client) => {
    try {
      return await client.delete({
        index: getAuditoriasIndex(),
        id: String(idAuditoria)
      });
    } catch (error) {
      if (error?.meta?.statusCode === 404) {
        return { notFound: true };
      }
      throw error;
    }
  });
}

async function pingElasticsearch() {
  if (!isElasticsearchEnabled()) {
    return {
      enabled: false,
      node: getElasticsearchNode(),
      index: getAuditoriasIndex(),
      connected: false
    };
  }

  try {
    await getElasticsearchClient().ping();
    return {
      enabled: true,
      node: getElasticsearchNode(),
      index: getAuditoriasIndex(),
      connected: true
    };
  } catch (error) {
    console.warn('[Elasticsearch] ping fallo:', {
      message: error?.message,
      statusCode: error?.meta?.statusCode
    });
    return {
      enabled: true,
      node: getElasticsearchNode(),
      index: getAuditoriasIndex(),
      connected: false
    };
  }
}

module.exports = {
  isElasticsearchEnabled,
  getEstadoAuditoriaNombre,
  buildAuditoriaDocument,
  indexAuditoria,
  updateAuditoria,
  updateEstadoAuditoria,
  deleteAuditoria,
  ensureAuditoriasIndex,
  pingElasticsearch
};
