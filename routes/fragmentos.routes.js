// Rutas de fragmentación (vistas) - Lab Bases de Datos Distribuidas.
const express = require('express');
const router = express.Router();

const { query } = require('../utils/db');

const VIEW_LIMIT = 50;

function sendMysqlError(res, err, context) {
  const safeContext = context ? ` (${context})` : '';

  if (err && err.code === 'DB_NOT_CONFIGURED') {
    return res.status(500).json({
      message:
        'MySQL no configurado: define DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME en el archivo .env'
    });
  }

  console.error(`[Fragmentos] Error${safeContext}:`, {
    code: err?.code,
    errno: err?.errno,
    sqlState: err?.sqlState,
    message: err?.message
  });

  return res.status(500).json({ message: `Error consultando MySQL${safeContext}.` });
}

function viewHandler(viewName) {
  return async (req, res) => {
    try {
      // viewName proviene de whitelist (constante), no del usuario.
      const rows = await query(`SELECT * FROM ${viewName} LIMIT ${VIEW_LIMIT};`);
      res.json(rows);
    } catch (err) {
      sendMysqlError(res, err, viewName);
    }
  };
}

// Empresas por región
router.get('/empresas/norte', viewHandler('empresas_norte'));
router.get('/empresas/centro', viewHandler('empresas_centro'));
router.get('/empresas/sur', viewHandler('empresas_sur'));

// Empresas por tipo_auditoria
router.get('/empresas/ambiental', viewHandler('empresas_ambiental'));
router.get('/empresas/financiera', viewHandler('empresas_financiera'));
router.get('/empresas/seguridad', viewHandler('empresas_seguridad'));

// Auditorías por región
router.get('/auditorias/norte', viewHandler('auditorias_norte'));
router.get('/auditorias/centro', viewHandler('auditorias_centro'));
router.get('/auditorias/sur', viewHandler('auditorias_sur'));

// Auditorías por tipo_auditoria
router.get('/auditorias/ambiental', viewHandler('auditorias_ambiental'));
router.get('/auditorias/financiera', viewHandler('auditorias_financiera'));
router.get('/auditorias/seguridad', viewHandler('auditorias_seguridad'));

module.exports = router;
