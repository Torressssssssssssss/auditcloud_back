// Servicio compartido para convertir un pago confirmado en una auditoria MySQL.
const { getPool } = require('./db');
const { readJson, writeJson } = require('./jsonDb');

const AUDITORIA_CREADA = 1;
const SOLICITUD_PAGADA = 2;
const AUDITORIA_CREATION_LOCK = 'auditcloud:create_auditoria_after_payment';

function toDate(value) {
  if (!value) return new Date();
  if (value instanceof Date) return value;

  const normalized = String(value).includes('T')
    ? String(value)
    : String(value).replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function toIsoDateTime(value) {
  return toDate(value).toISOString();
}

function toMysqlDateTime(value) {
  return toIsoDateTime(value).slice(0, 19).replace('T', ' ');
}

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeSolicitud(row = {}) {
  return {
    ...row,
    id_solicitud: Number(row.id_solicitud),
    id_empresa: Number(row.id_empresa),
    id_empresa_auditora: Number(row.id_empresa_auditora),
    id_empresa_cliente: row.id_empresa_cliente === null || row.id_empresa_cliente === undefined ? null : Number(row.id_empresa_cliente),
    id_cliente: Number(row.id_cliente),
    monto: Number(row.monto),
    id_estado: Number(row.id_estado),
    creado_en: toIsoDateTime(row.creado_en),
    pagada_en: row.pagada_en ? toIsoDateTime(row.pagada_en) : null
  };
}

function normalizeAuditoria(row = {}) {
  return {
    ...row,
    id_auditoria: Number(row.id_auditoria),
    id_empresa_auditora: Number(row.id_empresa_auditora),
    id_cliente: Number(row.id_cliente),
    id_solicitud_pago: Number(row.id_solicitud_pago),
    id_estado: Number(row.id_estado),
    monto: Number(row.monto),
    creada_en: toIsoDateTime(row.creada_en),
    objetivo: row.objetivo || null,
    estado_actualizado_en: row.estado_actualizado_en ? toIsoDateTime(row.estado_actualizado_en) : null,
    fecha_inicio: toDateOnly(row.fecha_inicio)
  };
}

async function acquireCreationLock(connection) {
  const [rows] = await connection.execute('SELECT GET_LOCK(?, 10) AS lock_ok;', [AUDITORIA_CREATION_LOCK]);
  const locked = Number(rows[0]?.lock_ok) === 1;
  if (!locked) {
    const error = new Error('No fue posible obtener bloqueo para crear auditoria.');
    error.code = 'AUDITORIA_LOCK_TIMEOUT';
    throw error;
  }
}

async function releaseCreationLock(connection) {
  try {
    await connection.execute('SELECT RELEASE_LOCK(?) AS released;', [AUDITORIA_CREATION_LOCK]);
  } catch (error) {
    console.error('[Auditorias] No fue posible liberar bloqueo de creacion:', error?.message || error);
  }
}

async function getAuditoriaBySolicitud(connection, idSolicitud) {
  const [rows] = await connection.execute(
    `SELECT
      id_auditoria,
      id_empresa_auditora,
      id_cliente,
      id_solicitud_pago,
      id_estado,
      monto,
      creada_en,
      objetivo,
      estado_actualizado_en,
      fecha_inicio
    FROM auditorias
    WHERE id_solicitud_pago = ?
    ORDER BY id_auditoria
    LIMIT 1
    FOR UPDATE;`,
    [Number(idSolicitud)]
  );

  return rows[0] ? normalizeAuditoria(rows[0]) : null;
}

async function getNextAuditoriaId(connection) {
  const [rows] = await connection.execute('SELECT COALESCE(MAX(id_auditoria), 0) + 1 AS next_id FROM auditorias;');
  return Number(rows[0]?.next_id || 1);
}

async function ensureAuditoriaAfterPayment(idSolicitud, options = {}) {
  const pool = getPool();
  const connection = await pool.getConnection();
  let transactionStarted = false;
  let lockAcquired = false;

  try {
    await acquireCreationLock(connection);
    lockAcquired = true;

    await connection.beginTransaction();
    transactionStarted = true;

    const [solicitudRows] = await connection.execute(
      `SELECT
        id_solicitud,
        id_empresa,
        id_empresa_auditora,
        id_empresa_cliente,
        id_cliente,
        monto,
        concepto,
        id_estado,
        creado_en,
        creado_por_supervisor,
        creado_por_auditor,
        pagada_en,
        paypal_order_id
      FROM solicitudes_pago
      WHERE id_solicitud = ?
      LIMIT 1
      FOR UPDATE;`,
      [Number(idSolicitud)]
    );

    if (!solicitudRows[0]) {
      const error = new Error(`Solicitud de pago ${idSolicitud} no existe en MySQL.`);
      error.code = 'SOLICITUD_NOT_FOUND';
      throw error;
    }

    const solicitudOriginal = normalizeSolicitud(solicitudRows[0]);
    const pagadaEn = toMysqlDateTime(solicitudOriginal.pagada_en || options.pagadaEn || new Date());
    const paypalOrderId = options.paypalOrderId || solicitudOriginal.paypal_order_id || null;

    if (paypalOrderId) {
      await connection.execute(
        `UPDATE solicitudes_pago
         SET id_estado = ?,
             pagada_en = ?,
             paypal_order_id = ?
         WHERE id_solicitud = ?;`,
        [SOLICITUD_PAGADA, pagadaEn, paypalOrderId, solicitudOriginal.id_solicitud]
      );
    } else {
      await connection.execute(
        `UPDATE solicitudes_pago
         SET id_estado = ?,
             pagada_en = ?
         WHERE id_solicitud = ?;`,
        [SOLICITUD_PAGADA, pagadaEn, solicitudOriginal.id_solicitud]
      );
    }

    const solicitud = {
      ...solicitudOriginal,
      id_estado: SOLICITUD_PAGADA,
      pagada_en: toIsoDateTime(pagadaEn),
      paypal_order_id: paypalOrderId
    };

    let auditoria = await getAuditoriaBySolicitud(connection, solicitud.id_solicitud);
    let created = false;

    if (!auditoria) {
      const idAuditoria = await getNextAuditoriaId(connection);
      const creadaEn = pagadaEn;

      await connection.execute(
        `INSERT INTO auditorias (
          id_auditoria,
          id_empresa_auditora,
          id_cliente,
          id_solicitud_pago,
          id_estado,
          monto,
          creada_en,
          objetivo,
          estado_actualizado_en,
          fecha_inicio
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL);`,
        [
          idAuditoria,
          solicitud.id_empresa_auditora || solicitud.id_empresa,
          solicitud.id_cliente,
          solicitud.id_solicitud,
          AUDITORIA_CREADA,
          solicitud.monto,
          creadaEn,
          creadaEn
        ]
      );

      auditoria = {
        id_auditoria: idAuditoria,
        id_empresa_auditora: solicitud.id_empresa_auditora || solicitud.id_empresa,
        id_cliente: solicitud.id_cliente,
        id_solicitud_pago: solicitud.id_solicitud,
        id_estado: AUDITORIA_CREADA,
        monto: solicitud.monto,
        creada_en: toIsoDateTime(creadaEn),
        objetivo: null,
        estado_actualizado_en: toIsoDateTime(creadaEn),
        fecha_inicio: null
      };
      created = true;
    }

    await connection.commit();
    transactionStarted = false;

    return {
      solicitud,
      auditoria,
      created
    };
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    throw error;
  } finally {
    if (lockAcquired) {
      await releaseCreationLock(connection);
    }
    connection.release();
  }
}

function normalizeAuditoriaForJson(auditoria) {
  return {
    id_auditoria: Number(auditoria.id_auditoria),
    id_empresa_auditora: Number(auditoria.id_empresa_auditora),
    id_cliente: Number(auditoria.id_cliente),
    id_solicitud_pago: Number(auditoria.id_solicitud_pago),
    id_estado: Number(auditoria.id_estado),
    monto: Number(auditoria.monto),
    creada_en: toIsoDateTime(auditoria.creada_en),
    objetivo: auditoria.objetivo || null,
    estado_actualizado_en: auditoria.estado_actualizado_en ? toIsoDateTime(auditoria.estado_actualizado_en) : null,
    fecha_inicio: toDateOnly(auditoria.fecha_inicio)
  };
}

async function syncLegacyJsonAfterPayment({ solicitud, auditoria, extraSolicitud = {} }) {
  const solicitudes = await readJson('solicitudes_pago.json');
  const solicitudIndex = solicitudes.findIndex((item) => Number(item.id_solicitud) === Number(solicitud.id_solicitud));

  const solicitudJson = {
    ...(solicitudIndex !== -1 ? solicitudes[solicitudIndex] : {}),
    ...solicitud,
    ...extraSolicitud,
    id_estado: SOLICITUD_PAGADA,
    pagada_en: toIsoDateTime(solicitud.pagada_en)
  };

  if (solicitudIndex !== -1) {
    solicitudes[solicitudIndex] = solicitudJson;
  } else {
    solicitudes.push(solicitudJson);
  }
  await writeJson('solicitudes_pago.json', solicitudes);

  const auditorias = await readJson('auditorias.json');
  const auditoriaJson = normalizeAuditoriaForJson(auditoria);
  const auditoriaIndex = auditorias.findIndex((item) =>
    Number(item.id_auditoria) === auditoriaJson.id_auditoria ||
    Number(item.id_solicitud_pago) === auditoriaJson.id_solicitud_pago
  );

  if (auditoriaIndex !== -1) {
    auditorias[auditoriaIndex] = {
      ...auditorias[auditoriaIndex],
      ...auditoriaJson
    };
  } else {
    auditorias.push(auditoriaJson);
  }
  await writeJson('auditorias.json', auditorias);

  return {
    solicitud: solicitudJson,
    auditoria: auditoriaJson
  };
}

module.exports = {
  ensureAuditoriaAfterPayment,
  syncLegacyJsonAfterPayment
};
