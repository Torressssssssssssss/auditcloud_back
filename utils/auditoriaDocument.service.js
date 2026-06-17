// Builder centralizado para documentos de auditoria desde MySQL.
const { query } = require('./db');

const ESTADOS_AUDITORIA = {
  1: 'CREADA',
  2: 'EN_PROCESO',
  3: 'FINALIZADA'
};

function getEstadoAuditoriaNombre(idEstado, nombreMysql) {
  return ESTADOS_AUDITORIA[Number(idEstado)] || nombreMysql || 'DESCONOCIDO';
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;

  const normalized = String(value).includes('T')
    ? String(value)
    : String(value).replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDateTime(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeNumber(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? null : numeric;
}

function normalizeBoolean(value) {
  if (value === null || value === undefined) return null;
  return Boolean(Number(value));
}

function normalizeReporte(row) {
  if (!row) return null;

  return {
    id_reporte: Number(row.id_reporte),
    id_auditoria: Number(row.id_auditoria),
    nombre: row.nombre,
    tipo: row.tipo,
    observaciones: row.observaciones || '',
    url: row.url,
    nombre_archivo: row.nombre_archivo,
    creado_por: Number(row.creado_por),
    fecha_creacion: toIsoDateTime(row.fecha_creacion)
  };
}

function normalizeParticipante(row) {
  return {
    id_participante: Number(row.id_participante),
    id_auditoria: Number(row.id_auditoria),
    id_auditor: Number(row.id_auditor),
    asignado_en: toIsoDateTime(row.asignado_en),
    usuario: {
      id_usuario: Number(row.id_usuario),
      id_empresa: normalizeNumber(row.id_empresa),
      nombre: row.nombre,
      correo: row.correo,
      id_rol: Number(row.id_rol),
      activo: normalizeBoolean(row.activo)
    }
  };
}

function normalizeModulo(row) {
  return {
    id_auditoria_modulo: Number(row.id_auditoria_modulo),
    id_auditoria: Number(row.id_auditoria),
    id_modulo: Number(row.id_modulo),
    registrado_en: toIsoDateTime(row.registrado_en),
    nombre: row.nombre,
    clave: row.clave || null
  };
}

function buildEmpresa(row, prefix) {
  const id = row[`${prefix}_id_empresa`];
  if (id === null || id === undefined) return null;

  return {
    id_empresa: Number(id),
    id_tipo_empresa: normalizeNumber(row[`${prefix}_id_tipo_empresa`]),
    tipo_auditoria: row[`${prefix}_tipo_auditoria`] || null,
    nombre: row[`${prefix}_nombre`] || null,
    rfc: row[`${prefix}_rfc`] || null,
    giro: row[`${prefix}_giro`] || null,
    direccion: row[`${prefix}_direccion`] || null,
    ciudad: row[`${prefix}_ciudad`] || null,
    estado: row[`${prefix}_estado`] || null,
    pais: row[`${prefix}_pais`] || null,
    activo: normalizeBoolean(row[`${prefix}_activo`])
  };
}

function buildSolicitudPago(row) {
  if (row.id_solicitud_pago_detalle === null || row.id_solicitud_pago_detalle === undefined) {
    return null;
  }

  return {
    id_solicitud: Number(row.id_solicitud_pago_detalle),
    id_empresa: Number(row.solicitud_id_empresa),
    id_empresa_auditora: Number(row.solicitud_id_empresa_auditora),
    id_empresa_cliente: normalizeNumber(row.solicitud_id_empresa_cliente),
    id_cliente: Number(row.solicitud_id_cliente),
    monto: normalizeNumber(row.solicitud_monto),
    concepto: row.solicitud_concepto,
    id_estado: Number(row.solicitud_id_estado),
    creado_en: toIsoDateTime(row.solicitud_creado_en),
    creado_por_supervisor: normalizeNumber(row.solicitud_creado_por_supervisor),
    creado_por_auditor: normalizeNumber(row.solicitud_creado_por_auditor),
    pagada_en: toIsoDateTime(row.solicitud_pagada_en),
    paypal_order_id: row.solicitud_paypal_order_id || null
  };
}

function buildAuditDocument(auditoria, reporteFinal, participantes, modulos) {
  const estadoNombre = getEstadoAuditoriaNombre(auditoria.id_estado, auditoria.estado_nombre_mysql);

  return {
    id_auditoria: Number(auditoria.id_auditoria),
    id_estado: Number(auditoria.id_estado),
    estado_auditoria: estadoNombre,
    estado_nombre: estadoNombre,
    id_cliente: Number(auditoria.id_cliente),
    id_empresa_auditora: Number(auditoria.id_empresa_auditora),
    id_solicitud_pago: Number(auditoria.id_solicitud_pago),
    monto: normalizeNumber(auditoria.monto),
    fecha_inicio: toDateOnly(auditoria.fecha_inicio),
    creada_en: toIsoDateTime(auditoria.creada_en),
    estado_actualizado_en: toIsoDateTime(auditoria.estado_actualizado_en),
    objetivo: auditoria.objetivo || null,
    reporte_final: normalizeReporte(reporteFinal),
    participantes: participantes.map(normalizeParticipante),
    modulos: modulos.map(normalizeModulo),
    cliente: {
      id_usuario: Number(auditoria.cliente_id_usuario),
      id_empresa: normalizeNumber(auditoria.cliente_id_empresa),
      nombre: auditoria.cliente_nombre,
      correo: auditoria.cliente_correo,
      id_rol: Number(auditoria.cliente_id_rol),
      activo: normalizeBoolean(auditoria.cliente_activo)
    },
    empresa_auditora: buildEmpresa(auditoria, 'empresa_auditora'),
    empresa_cliente: buildEmpresa(auditoria, 'empresa_cliente'),
    solicitud_pago: buildSolicitudPago(auditoria)
  };
}

async function getAuditDocumentById(idAuditoria) {
  const auditoriaId = Number(idAuditoria);
  if (!Number.isInteger(auditoriaId) || auditoriaId <= 0) {
    const error = new Error('id_auditoria invalido.');
    error.code = 'AUDITORIA_ID_INVALIDO';
    throw error;
  }

  const auditorias = await query(
    `SELECT
      a.id_auditoria,
      a.id_estado,
      ea.nombre AS estado_nombre_mysql,
      a.id_cliente,
      a.id_empresa_auditora,
      a.id_solicitud_pago,
      a.monto,
      a.fecha_inicio,
      a.creada_en,
      a.estado_actualizado_en,
      a.objetivo,

      cliente.id_usuario AS cliente_id_usuario,
      cliente.id_empresa AS cliente_id_empresa,
      cliente.nombre AS cliente_nombre,
      cliente.correo AS cliente_correo,
      cliente.id_rol AS cliente_id_rol,
      cliente.activo AS cliente_activo,

      sp.id_solicitud AS id_solicitud_pago_detalle,
      sp.id_empresa AS solicitud_id_empresa,
      sp.id_empresa_auditora AS solicitud_id_empresa_auditora,
      sp.id_empresa_cliente AS solicitud_id_empresa_cliente,
      sp.id_cliente AS solicitud_id_cliente,
      sp.monto AS solicitud_monto,
      sp.concepto AS solicitud_concepto,
      sp.id_estado AS solicitud_id_estado,
      sp.creado_en AS solicitud_creado_en,
      sp.creado_por_supervisor AS solicitud_creado_por_supervisor,
      sp.creado_por_auditor AS solicitud_creado_por_auditor,
      sp.pagada_en AS solicitud_pagada_en,
      sp.paypal_order_id AS solicitud_paypal_order_id,

      eaud.id_empresa AS empresa_auditora_id_empresa,
      eaud.id_tipo_empresa AS empresa_auditora_id_tipo_empresa,
      eaud.tipo_auditoria AS empresa_auditora_tipo_auditoria,
      eaud.nombre AS empresa_auditora_nombre,
      eaud.rfc AS empresa_auditora_rfc,
      eaud.giro AS empresa_auditora_giro,
      eaud.direccion AS empresa_auditora_direccion,
      eaud.ciudad AS empresa_auditora_ciudad,
      eaud.estado AS empresa_auditora_estado,
      eaud.pais AS empresa_auditora_pais,
      eaud.activo AS empresa_auditora_activo,

      ecli.id_empresa AS empresa_cliente_id_empresa,
      ecli.id_tipo_empresa AS empresa_cliente_id_tipo_empresa,
      ecli.tipo_auditoria AS empresa_cliente_tipo_auditoria,
      ecli.nombre AS empresa_cliente_nombre,
      ecli.rfc AS empresa_cliente_rfc,
      ecli.giro AS empresa_cliente_giro,
      ecli.direccion AS empresa_cliente_direccion,
      ecli.ciudad AS empresa_cliente_ciudad,
      ecli.estado AS empresa_cliente_estado,
      ecli.pais AS empresa_cliente_pais,
      ecli.activo AS empresa_cliente_activo
    FROM auditorias a
    LEFT JOIN estados_auditoria ea ON ea.id_estado = a.id_estado
    LEFT JOIN usuarios cliente ON cliente.id_usuario = a.id_cliente
    LEFT JOIN solicitudes_pago sp ON sp.id_solicitud = a.id_solicitud_pago
    LEFT JOIN empresas eaud ON eaud.id_empresa = a.id_empresa_auditora
    LEFT JOIN empresas ecli ON ecli.id_empresa = COALESCE(sp.id_empresa_cliente, cliente.id_empresa)
    WHERE a.id_auditoria = ?
    LIMIT 1;`,
    [auditoriaId]
  );

  if (!auditorias[0]) {
    return null;
  }

  const [reporteFinalRows, participantesRows, modulosRows] = await Promise.all([
    query(
      `SELECT
        id_reporte,
        id_auditoria,
        nombre,
        tipo,
        observaciones,
        url,
        nombre_archivo,
        creado_por,
        fecha_creacion
      FROM reportes
      WHERE id_auditoria = ? AND tipo = 'FINAL'
      ORDER BY fecha_creacion DESC, id_reporte DESC
      LIMIT 1;`,
      [auditoriaId]
    ),
    query(
      `SELECT
        ap.id_participante,
        ap.id_auditoria,
        ap.id_auditor,
        ap.asignado_en,
        u.id_usuario,
        u.id_empresa,
        u.nombre,
        u.correo,
        u.id_rol,
        u.activo
      FROM auditoria_participantes ap
      JOIN usuarios u ON u.id_usuario = ap.id_auditor
      WHERE ap.id_auditoria = ?
      ORDER BY ap.asignado_en ASC, ap.id_participante ASC;`,
      [auditoriaId]
    ),
    query(
      `SELECT
        am.id_auditoria_modulo,
        am.id_auditoria,
        am.id_modulo,
        am.registrado_en,
        m.nombre,
        m.clave
      FROM auditoria_modulos am
      JOIN modulos_ambientales m ON m.id_modulo = am.id_modulo
      WHERE am.id_auditoria = ?
      ORDER BY am.registrado_en ASC, am.id_auditoria_modulo ASC;`,
      [auditoriaId]
    )
  ]);

  return buildAuditDocument(
    auditorias[0],
    reporteFinalRows[0] || null,
    participantesRows,
    modulosRows
  );
}

module.exports = {
  getAuditDocumentById,
  getEstadoAuditoriaNombre
};
