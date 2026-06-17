// Servicio para actualizar estado de auditorias con MySQL como fuente principal.
const { getPool } = require('./db');
const { readJson, writeJson } = require('./jsonDb');

const ESTADOS_AUDITORIA_VALIDOS = new Set([1, 2, 3]);

function parseEstadoAuditoria(idEstado) {
  const estado = Number(idEstado);
  return Number.isInteger(estado) ? estado : null;
}

function isEstadoAuditoriaValido(idEstado) {
  const estado = parseEstadoAuditoria(idEstado);
  return ESTADOS_AUDITORIA_VALIDOS.has(estado);
}

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

async function updateAuditoriaEstadoMysql(idAuditoria, idEstado, options = {}) {
  const estado = parseEstadoAuditoria(idEstado);
  if (!ESTADOS_AUDITORIA_VALIDOS.has(estado)) {
    const error = new Error('id_estado invalido. Usa 1, 2 o 3.');
    error.code = 'AUDITORIA_ESTADO_INVALIDO';
    throw error;
  }

  const pool = getPool();
  const connection = await pool.getConnection();
  const actualizadoEn = toMysqlDateTime(options.actualizadoEn || new Date());
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

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
      WHERE id_auditoria = ?
      LIMIT 1
      FOR UPDATE;`,
      [Number(idAuditoria)]
    );

    if (!rows[0]) {
      const error = new Error('Auditoria no encontrada en MySQL.');
      error.code = 'AUDITORIA_NOT_FOUND';
      throw error;
    }

    const actual = normalizeAuditoria(rows[0]);
    if (
      options.idEmpresaAuditora !== undefined &&
      options.idEmpresaAuditora !== null &&
      Number(actual.id_empresa_auditora) !== Number(options.idEmpresaAuditora)
    ) {
      const error = new Error('No tienes permiso para actualizar esta auditoria.');
      error.code = 'AUDITORIA_FORBIDDEN';
      throw error;
    }

    await connection.execute(
      `UPDATE auditorias
       SET id_estado = ?,
           estado_actualizado_en = ?
       WHERE id_auditoria = ?;`,
      [estado, actualizadoEn, Number(idAuditoria)]
    );

    await connection.commit();
    transactionStarted = false;

    return {
      ...actual,
      id_estado: estado,
      estado_actualizado_en: toIsoDateTime(actualizadoEn)
    };
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function syncAuditoriaEstadoJson(auditoria) {
  const auditorias = await readJson('auditorias.json');
  const index = auditorias.findIndex((item) => Number(item.id_auditoria) === Number(auditoria.id_auditoria));

  const auditoriaJson = {
    ...auditoria,
    id_auditoria: Number(auditoria.id_auditoria),
    id_empresa_auditora: Number(auditoria.id_empresa_auditora),
    id_cliente: Number(auditoria.id_cliente),
    id_solicitud_pago: Number(auditoria.id_solicitud_pago),
    id_estado: Number(auditoria.id_estado),
    monto: Number(auditoria.monto),
    creada_en: toIsoDateTime(auditoria.creada_en),
    estado_actualizado_en: toIsoDateTime(auditoria.estado_actualizado_en),
    fecha_inicio: toDateOnly(auditoria.fecha_inicio)
  };

  if (index !== -1) {
    auditorias[index] = {
      ...auditorias[index],
      id_estado: auditoriaJson.id_estado,
      estado_actualizado_en: auditoriaJson.estado_actualizado_en
    };
  } else {
    auditorias.push(auditoriaJson);
  }

  await writeJson('auditorias.json', auditorias);
  return index !== -1 ? auditorias[index] : auditoriaJson;
}

module.exports = {
  isEstadoAuditoriaValido,
  updateAuditoriaEstadoMysql,
  syncAuditoriaEstadoJson
};
