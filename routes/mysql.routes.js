// Rutas de prueba MySQL: integración paralela sin afectar JSON.
const express = require('express');
const router = express.Router();

const { query } = require('../utils/db');

function sendMysqlError(res, err, context) {
  const safeContext = context ? ` (${context})` : '';

  if (err && err.code === 'DB_NOT_CONFIGURED') {
    return res.status(500).json({
      message:
        'MySQL no configurado: define DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME en el archivo .env'
    });
  }

  // Log interno sin exponer secretos
  console.error(`[MySQL] Error${safeContext}:`, {
    code: err?.code,
    errno: err?.errno,
    sqlState: err?.sqlState,
    message: err?.message
  });

  return res.status(500).json({
    message: `Error consultando MySQL${safeContext}.`
  });
}

// GET /api/mysql/health
router.get('/health', async (req, res) => {
  try {
    const rows = await query('SELECT 1 AS ok;');
    res.json(rows[0] || { ok: 1 });
  } catch (err) {
    sendMysqlError(res, err, 'health');
  }
});

// GET /api/mysql/empresas
router.get('/empresas', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM empresas ORDER BY id_empresa LIMIT 50;');
    res.json(rows);
  } catch (err) {
    sendMysqlError(res, err, 'empresas');
  }
});

// GET /api/mysql/usuarios
router.get('/usuarios', async (req, res) => {
  try {
    const rows = await query(
      `SELECT
        u.id_usuario,
        u.id_empresa,
        u.nombre,
        u.correo,
        u.id_rol,
        r.nombre AS rol_nombre,
        u.activo,
        u.google_id,
        u.creado_en,
        e.nombre AS empresa_nombre,
        e.tipo_auditoria AS empresa_tipo_auditoria,
        e.estado AS empresa_estado,
        e.ciudad AS empresa_ciudad
      FROM usuarios u
      JOIN roles r ON r.id_rol = u.id_rol
      LEFT JOIN empresas e ON e.id_empresa = u.id_empresa
      ORDER BY u.id_usuario
      LIMIT 50;`
    );

    res.json(rows);
  } catch (err) {
    sendMysqlError(res, err, 'usuarios');
  }
});

// GET /api/mysql/auditorias
router.get('/auditorias', async (req, res) => {
  try {
    const rows = await query(
      `SELECT
        a.id_auditoria,
        a.id_empresa_auditora,
        auditora.nombre AS empresa_auditora_nombre,
        auditora.tipo_auditoria AS empresa_auditora_tipo_auditoria,
        a.id_cliente,
        cliente.nombre AS cliente_nombre,
        cliente.correo AS cliente_correo,
        cliente.id_empresa AS id_empresa_cliente,
        cliente_empresa.nombre AS empresa_cliente_nombre,
        cliente_empresa.estado AS empresa_cliente_estado,
        cliente_empresa.tipo_auditoria AS empresa_cliente_tipo_auditoria,
        a.id_solicitud_pago,
        a.id_estado,
        ea.nombre AS estado_nombre,
        a.monto,
        a.creada_en,
        a.objetivo,
        a.estado_actualizado_en,
        a.fecha_inicio
      FROM auditorias a
      JOIN empresas auditora ON auditora.id_empresa = a.id_empresa_auditora
      JOIN usuarios cliente ON cliente.id_usuario = a.id_cliente
      LEFT JOIN empresas cliente_empresa ON cliente_empresa.id_empresa = cliente.id_empresa
      JOIN estados_auditoria ea ON ea.id_estado = a.id_estado
      ORDER BY a.id_auditoria
      LIMIT 50;`
    );

    res.json(rows);
  } catch (err) {
    sendMysqlError(res, err, 'auditorias');
  }
});

// GET /api/mysql/resumen
router.get('/resumen', async (req, res) => {
  try {
    const rows = await query(
      `SELECT 'empresas' AS clave, COUNT(*) AS total FROM empresas
      UNION ALL SELECT 'usuarios', COUNT(*) FROM usuarios
      UNION ALL SELECT 'auditorias', COUNT(*) FROM auditorias
      UNION ALL SELECT 'solicitudes_pago', COUNT(*) FROM solicitudes_pago
      UNION ALL SELECT 'evidencias', COUNT(*) FROM evidencias
      UNION ALL SELECT 'reportes', COUNT(*) FROM reportes
      UNION ALL SELECT 'mensajes', COUNT(*) FROM mensajes
      UNION ALL SELECT 'notificaciones', COUNT(*) FROM notificaciones;`
    );

    const resumen = {};
    for (const row of rows) {
      resumen[row.clave] = Number(row.total);
    }

    res.json(resumen);
  } catch (err) {
    sendMysqlError(res, err, 'resumen');
  }
});

module.exports = router;
