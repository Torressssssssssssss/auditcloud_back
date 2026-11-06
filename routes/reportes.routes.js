const { verificarPerfilEmpresa } = require('../middleware/verificarPerfilEmpresa');
const express = require('express');
const { authenticate, authorize } = require('../utils/auth');
const { generarReporte } = require('../controllers/reportes.controller');

const router = express.Router();
router.get('/generar/:id_auditoria', authenticate, authorize([1, 2, 3]), verificarPerfilEmpresa('auditoria'), generarReporte);

module.exports = router;
