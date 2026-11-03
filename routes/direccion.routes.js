const express = require('express');
const { authenticate, authorize } = require('../utils/auth');
const { obtenerConsumosMensuales } = require('../services/dashboardDirectivo.service');
const { transactionalRouter } = require('../utils/sqlRouter');
const rutas = express.Router();

rutas.get('/consumos-mensuales', authenticate, authorize([1]), async (solicitud, respuesta) =>
{
  const valor = solicitud.query.anio === undefined ? String(new Date().getUTCFullYear()) : solicitud.query.anio;
  if(typeof valor !== 'string' || !/^[1-9]\d{3}$/.test(valor))
  {
    return respuesta.status(400).json({ message: 'Selecciona un año entre 1000 y 9999.' });
  }
  const idEmpresa = solicitud.user.id_empresa;
  if(!Number.isInteger(idEmpresa) || idEmpresa < 1)
  {
    return respuesta.status(403).json({ message: 'La sesión no tiene una empresa válida.' });
  }
  respuesta.json(await obtenerConsumosMensuales(idEmpresa, Number(valor)));
});

module.exports = transactionalRouter(rutas);
