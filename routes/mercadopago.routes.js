// Rutas de Mercado Pago Checkout Pro: diagnostico, preferencias, webhook y confirmacion.
const express = require('express');
const router = express.Router();

const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { query } = require('../utils/db');
const { readJson, writeJson } = require('../utils/jsonDb');
const { authenticate, authorize } = require('../utils/auth');

function getMercadoPagoAccessToken() {
  return String(process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
}

function getFrontendUrl() {
  return String(process.env.FRONTEND_URL || 'http://localhost:4200')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\/$/, '');
}

function getMercadoPagoClient() {
  const accessToken = getMercadoPagoAccessToken();
  if (!accessToken) {
    const error = new Error('Mercado Pago no esta configurado en el servidor');
    error.statusCode = 500;
    throw error;
  }

  return new MercadoPagoConfig({ accessToken });
}

function getPreferenceClient() {
  return new Preference(getMercadoPagoClient());
}

function getPaymentClient() {
  return new Payment(getMercadoPagoClient());
}

function construirBackUrls(baseUrl) {
  const fallback = 'http://localhost:4200';
  const base = String(baseUrl || fallback).trim().replace(/\/$/, '') || fallback;

  return {
    success: `${base}/cliente/pagos?status=success`,
    failure: `${base}/cliente/pagos?status=failure`,
    pending: `${base}/cliente/pagos?status=pending`
  };
}

function esLocalhost(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    const host = String(parsed.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return true;
  }
}

function permiteAutoReturn(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    return parsed.protocol === 'https:' && !esLocalhost(baseUrl);
  } catch {
    return false;
  }
}

function normalizarSolicitud(solicitud = {}) {
  return {
    ...solicitud,
    id_solicitud: Number(solicitud.id_solicitud),
    id_empresa: solicitud.id_empresa !== undefined && solicitud.id_empresa !== null ? Number(solicitud.id_empresa) : null,
    id_empresa_auditora: solicitud.id_empresa_auditora !== undefined && solicitud.id_empresa_auditora !== null ? Number(solicitud.id_empresa_auditora) : null,
    id_empresa_cliente: solicitud.id_empresa_cliente !== undefined && solicitud.id_empresa_cliente !== null ? Number(solicitud.id_empresa_cliente) : null,
    id_cliente: solicitud.id_cliente !== undefined && solicitud.id_cliente !== null ? Number(solicitud.id_cliente) : null,
    monto: Number(solicitud.monto),
    id_estado: Number(solicitud.id_estado)
  };
}

function esSolicitudPendiente(solicitud = {}) {
  const estadoNumerico = Number(solicitud.id_estado);
  if (estadoNumerico === 1) {
    return true;
  }

  const estadoTexto = String(solicitud.estado || solicitud.estatus || '').trim().toLowerCase();
  return estadoTexto === 'pendiente';
}

function obtenerIdSolicitudDesdeBody(body = {}) {
  return body.id_solicitud_pago || body.id_solicitud || body.idSolicitudPago || body.idSolicitud;
}

function validarMonto(solicitud) {
  const monto = Number(solicitud.monto);
  return Number.isFinite(monto) && monto > 0;
}

function montosCoinciden(a, b) {
  const montoA = Number(a);
  const montoB = Number(b);
  if (!Number.isFinite(montoA) || !Number.isFinite(montoB)) {
    return true;
  }

  return Math.abs(montoA - montoB) < 0.01;
}

function sanitizeMercadoPagoError(error) {
  return {
    message: error?.message || 'Error de Mercado Pago',
    status: error?.status || error?.statusCode || error?.cause?.status,
    cause: Array.isArray(error?.cause)
      ? error.cause.map(item => ({ code: item?.code, description: item?.description }))
      : undefined
  };
}

async function obtenerSolicitudPago(idSolicitud) {
  const idBuscado = Number(idSolicitud);
  if (!Number.isInteger(idBuscado) || idBuscado <= 0) {
    return null;
  }

  const solicitudes = await readJson('solicitudes_pago.json');
  const solicitudJson = solicitudes.find(s => Number(s.id_solicitud) === idBuscado);

  if (solicitudJson) {
    return { fuente: 'json', solicitud: normalizarSolicitud(solicitudJson) };
  }

  try {
    const rows = await query(
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
        pagada_en
      FROM solicitudes_pago
      WHERE id_solicitud = ?
      LIMIT 1;`,
      [idBuscado]
    );

    if (rows && rows[0]) {
      return { fuente: 'mysql', solicitud: normalizarSolicitud(rows[0]) };
    }
  } catch (error) {
    if (error?.code !== 'DB_NOT_CONFIGURED') {
      console.warn('MySQL no disponible para solicitudes de pago:', error?.code || error?.message || error);
    }
  }

  return null;
}

async function guardarSolicitudPagada(solicitudActualizada) {
  const solicitudes = await readJson('solicitudes_pago.json');
  const idx = solicitudes.findIndex(s => Number(s.id_solicitud) === Number(solicitudActualizada.id_solicitud));
  if (idx !== -1) {
    solicitudes[idx] = {
      ...solicitudes[idx],
      ...solicitudActualizada
    };
    await writeJson('solicitudes_pago.json', solicitudes);
  }

  try {
    await query(
      `UPDATE solicitudes_pago
       SET id_estado = 2,
           pagada_en = ?
       WHERE id_solicitud = ?;`,
      [solicitudActualizada.pagada_en, Number(solicitudActualizada.id_solicitud)]
    );
  } catch (error) {
    if (error?.code !== 'DB_NOT_CONFIGURED') {
      console.warn('No fue posible actualizar la solicitud en MySQL:', error?.code || error?.message || error);
    }
  }
}

function construirDatosMercadoPago(paymentData = {}) {
  return {
    mercadopago_payment_id: paymentData?.id ? String(paymentData.id) : null,
    id_pago_mercadopago: paymentData?.id ? String(paymentData.id) : null,
    id_preferencia: paymentData?.preference_id || paymentData?.order?.id || null,
    preference_id: paymentData?.preference_id || paymentData?.order?.id || null,
    mercadopago_external_reference: paymentData?.external_reference || null,
    mercadopago_metadata_id_solicitud_pago: paymentData?.metadata?.id_solicitud_pago || null,
    mercadopago_status: paymentData?.status || null,
    mercadopago_status_detail: paymentData?.status_detail || null,
    mercadopago_payment_method_id: paymentData?.payment_method_id || null,
    mercadopago_payment_type_id: paymentData?.payment_type_id || null,
    mercadopago_transaction_amount: paymentData?.transaction_amount !== undefined ? Number(paymentData.transaction_amount) : null,
    mercadopago_actualizado_en: new Date().toISOString()
  };
}

function obtenerIdNumerico(candidato) {
  const id = Number(candidato);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function obtenerIdsSolicitudDesdeMetadata(paymentData = {}) {
  const metadata = paymentData?.metadata || {};
  return [
    metadata.id_solicitud_pago,
    metadata.id_solicitud,
    metadata.idSolicitudPago,
    metadata.idSolicitud
  ]
    .map(obtenerIdNumerico)
    .filter(Boolean);
}

function obtenerPreferenceIdDesdePayment(paymentData = {}) {
  return paymentData?.preference_id || paymentData?.order?.id || null;
}

function buscarJsonPorIdMercadoPago(solicitudes, paymentId) {
  if (!paymentId) {
    return null;
  }

  return solicitudes.find(s => (
    String(s.mercadopago_payment_id || '') === String(paymentId) ||
    String(s.id_pago_mercadopago || '') === String(paymentId)
  )) || null;
}

function buscarJsonPorPreferenceId(solicitudes, preferenceId) {
  if (!preferenceId) {
    return null;
  }

  return solicitudes.find(s => String(s.id_preferencia || s.preference_id || '') === String(preferenceId)) || null;
}

async function buscarSolicitudPorIdConMonto(idSolicitud, montoPago, match) {
  const resultado = await obtenerSolicitudPago(idSolicitud);
  if (resultado && montosCoinciden(resultado.solicitud.monto, montoPago)) {
    return { ...resultado, match: `${resultado.fuente}_${match}` };
  }

  return null;
}

async function buscarSolicitudPorMercadoPago(paymentData = {}) {
  const montoPago = Number(paymentData?.transaction_amount);
  const paymentId = paymentData?.id ? String(paymentData.id) : null;
  const preferenceId = obtenerPreferenceIdDesdePayment(paymentData);
  const externalReferenceId = obtenerIdNumerico(paymentData?.external_reference);
  const metadataIds = obtenerIdsSolicitudDesdeMetadata(paymentData);
  const solicitudes = await readJson('solicitudes_pago.json');

  const solicitudPorPaymentId = buscarJsonPorIdMercadoPago(solicitudes, paymentId);
  if (solicitudPorPaymentId && montosCoinciden(solicitudPorPaymentId.monto, montoPago)) {
    return { fuente: 'json', solicitud: normalizarSolicitud(solicitudPorPaymentId), match: 'json_payment_id' };
  }

  const solicitudPorPreferencia = buscarJsonPorPreferenceId(solicitudes, preferenceId);
  if (solicitudPorPreferencia && montosCoinciden(solicitudPorPreferencia.monto, montoPago)) {
    return { fuente: 'json', solicitud: normalizarSolicitud(solicitudPorPreferencia), match: 'json_preference_id' };
  }

  if (externalReferenceId) {
    const resultado = await buscarSolicitudPorIdConMonto(externalReferenceId, montoPago, 'external_reference');
    if (resultado) {
      return resultado;
    }
  }

  for (const metadataId of metadataIds) {
    const resultado = await buscarSolicitudPorIdConMonto(metadataId, montoPago, 'metadata_id');
    if (resultado) {
      return resultado;
    }
  }

  return null;
}

async function guardarDatosMercadoPago(solicitud, paymentData = {}) {
  const datosMercadoPago = construirDatosMercadoPago(paymentData);
  const status = String(paymentData?.status || '').toLowerCase();
  const ahora = new Date().toISOString();
  const solicitudActualizada = {
    ...solicitud,
    ...datosMercadoPago
  };

  if (status === 'approved') {
    solicitudActualizada.id_estado = 2;
    solicitudActualizada.pagada_en = solicitud.pagada_en || ahora;
  }

  const solicitudes = await readJson('solicitudes_pago.json');
  const idx = solicitudes.findIndex(s => Number(s.id_solicitud) === Number(solicitud.id_solicitud));
  let jsonActualizado = false;
  if (idx !== -1) {
    solicitudes[idx] = {
      ...solicitudes[idx],
      ...solicitudActualizada
    };
    await writeJson('solicitudes_pago.json', solicitudes);
    jsonActualizado = true;
  }

  let mysqlActualizado = false;
  try {
    if (status === 'approved') {
      const result = await query(
        `UPDATE solicitudes_pago
         SET id_estado = 2,
             pagada_en = ?
         WHERE id_solicitud = ?
           AND ABS(monto - ?) < 0.01;`,
        [
          solicitudActualizada.pagada_en,
          Number(solicitud.id_solicitud),
          Number(paymentData?.transaction_amount || solicitud.monto)
        ]
      );
      mysqlActualizado = Number(result?.affectedRows || 0) > 0;
    }
  } catch (error) {
    if (error?.code !== 'DB_NOT_CONFIGURED') {
      console.warn('No fue posible sincronizar pago Mercado Pago en MySQL:', error?.code || error?.message || error);
    }
  }

  return {
    solicitud: normalizarSolicitud(solicitudActualizada),
    jsonActualizado,
    mysqlActualizado
  };
}

async function guardarPreferenciaSolicitud(idSolicitud, data = {}) {
  const idBuscado = Number(idSolicitud);
  const solicitudes = await readJson('solicitudes_pago.json');
  const idx = solicitudes.findIndex(s => Number(s.id_solicitud) === idBuscado);

  if (idx !== -1) {
    solicitudes[idx] = {
      ...solicitudes[idx],
      id_preferencia: data.id || solicitudes[idx].id_preferencia || null,
      preference_id: data.id || solicitudes[idx].preference_id || null,
      mercadopago_preference_created_at: new Date().toISOString()
    };
    await writeJson('solicitudes_pago.json', solicitudes);
  }
}

async function procesarPagoMercadoPago(paymentOrId) {
  const paymentData = typeof paymentOrId === 'object' && paymentOrId !== null
    ? paymentOrId
    : await obtenerPaymentMercadoPago(paymentOrId);

  const paymentId = paymentData?.id ? String(paymentData.id) : null;
  const status = paymentData?.status || null;
  const statusDetail = paymentData?.status_detail || null;
  const resultadoSolicitud = await buscarSolicitudPorMercadoPago(paymentData);

  if (!resultadoSolicitud) {
    return {
      procesado: false,
      payment: paymentData,
      payment_id: paymentId,
      status,
      status_detail: statusDetail,
      message: 'No se encontro una solicitud interna para el pago de Mercado Pago'
    };
  }

  const { solicitud, jsonActualizado, mysqlActualizado } = await guardarDatosMercadoPago(
    resultadoSolicitud.solicitud,
    paymentData
  );

  return {
    procesado: true,
    payment: paymentData,
    payment_id: paymentId,
    status,
    status_detail: statusDetail,
    solicitud,
    match: resultadoSolicitud.match,
    jsonActualizado,
    mysqlActualizado,
    message: status === 'approved'
      ? 'Pago aprobado y solicitud actualizada'
      : 'Estado de Mercado Pago guardado'
  };
}

function extraerPaymentIdMercadoPago(req) {
  const candidatos = [
    req.query?.['data.id'],
    req.body?.data?.id,
    req.body?.id,
    req.query?.id,
    req.query?.payment_id,
    req.body?.payment_id
  ];

  for (const candidato of candidatos) {
    if (candidato) {
      return String(candidato);
    }
  }

  const resource = req.body?.resource || req.query?.resource;
  if (resource) {
    const match = String(resource).match(/\/payments\/(\d+)/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function obtenerTipoWebhookMercadoPago(req) {
  return req.query.type || req.body?.type || req.body?.topic || req.query.topic || req.body?.action || null;
}

function construirMensajeEstado(solicitud = {}) {
  if (Number(solicitud.id_estado) === 2 || solicitud.mercadopago_status === 'approved') {
    return 'Pago confirmado.';
  }

  if (solicitud.mercadopago_status === 'pending' || solicitud.mercadopago_status === 'in_process') {
    return 'El pago aun esta pendiente de confirmacion.';
  }

  if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(String(solicitud.mercadopago_status || ''))) {
    return 'El pago no se completo en Mercado Pago.';
  }

  return 'Aun no se confirma el pago.';
}

async function validarPermisoCliente(solicitud, req) {
  const idUsuario = Number(req.user.id_usuario);
  const idEmpresa = Number(req.user.id_empresa);

  return Number(solicitud.id_cliente) === idUsuario || Number(solicitud.id_empresa_cliente) === idEmpresa;
}

function construirPreferencePayload(solicitud) {
  const frontendUrl = getFrontendUrl();
  const backUrls = construirBackUrls(frontendUrl);
  const payload = {
    items: [
      {
        title: `AuditCloud - ${String(solicitud.concepto || 'Solicitud de pago')}`,
        quantity: 1,
        unit_price: Number(solicitud.monto),
        currency_id: 'MXN'
      }
    ],
    external_reference: String(solicitud.id_solicitud),
    metadata: {
      id_solicitud_pago: Number(solicitud.id_solicitud),
      id_empresa_cliente: solicitud.id_empresa_cliente || null,
      id_cliente: solicitud.id_cliente || null
    },
    back_urls: backUrls
  };

  if (permiteAutoReturn(frontendUrl)) {
    payload.auto_return = 'approved';
  }

  return payload;
}

async function obtenerPaymentMercadoPago(paymentId) {
  const payment = getPaymentClient();
  return payment.get({ id: String(paymentId) });
}

async function buscarPaymentMercadoPagoPorSolicitud(solicitud) {
  const accessToken = getMercadoPagoAccessToken();
  if (!accessToken) {
    return null;
  }

  const params = new URLSearchParams({
    external_reference: String(solicitud.id_solicitud),
    sort: 'date_created',
    criteria: 'desc'
  });

  const response = await fetch(`https://api.mercadopago.com/v1/payments/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const pagos = Array.isArray(data?.results) ? data.results : [];
  return pagos.find(payment => montosCoinciden(payment?.transaction_amount, solicitud.monto)) || null;
}

async function sincronizarEstadoDesdeMercadoPago(solicitud) {
  if (Number(solicitud.id_estado) === 2) {
    return solicitud;
  }

  try {
    let paymentData = null;
    const paymentId = solicitud.mercadopago_payment_id || solicitud.id_pago_mercadopago;

    if (paymentId) {
      paymentData = await obtenerPaymentMercadoPago(paymentId);
    } else {
      paymentData = await buscarPaymentMercadoPagoPorSolicitud(solicitud);
    }

    if (!paymentData) {
      return solicitud;
    }

    const resultado = await procesarPagoMercadoPago(paymentData);
    return resultado.solicitud || solicitud;
  } catch (error) {
    console.warn('No fue posible sincronizar estado Mercado Pago:', sanitizeMercadoPagoError(error));
    return solicitud;
  }
}

// GET /api/mercadopago/status y /api/pagos/mercadopago/status
router.get('/status', (req, res) => {
  const accessTokenConfigured = Boolean(getMercadoPagoAccessToken());
  const frontendUrlConfigured = Boolean(getFrontendUrl());

  return res.json({
    ok: true,
    sdkInstalled: Boolean(MercadoPagoConfig && Preference && Payment),
    accessTokenConfigured,
    frontendUrlConfigured,
    mercadoPagoApiConfigured: Boolean(process.env.MERCADOPAGO_API),
    mode: 'test-or-dev'
  });
});

// POST /api/mercadopago/preferencia y /api/pagos/mercadopago/preferencia
router.post('/preferencia', authenticate, authorize([3]), async (req, res) => {
  try {
    const idSolicitud = obtenerIdSolicitudDesdeBody(req.body);

    if (!idSolicitud) {
      return res.status(400).json({ message: 'id_solicitud_pago o id_solicitud es obligatorio' });
    }

    const resultado = await obtenerSolicitudPago(idSolicitud);
    if (!resultado) {
      return res.status(404).json({ message: 'Solicitud de pago no encontrada' });
    }

    const solicitud = resultado.solicitud;

    if (!esSolicitudPendiente(solicitud)) {
      return res.status(400).json({ message: 'La solicitud ya fue pagada o no esta pendiente' });
    }

    if (!validarMonto(solicitud)) {
      return res.status(400).json({ message: 'La solicitud no tiene un monto valido para Mercado Pago' });
    }

    const autorizado = await validarPermisoCliente(solicitud, req);
    if (!autorizado) {
      return res.status(403).json({ message: 'No tienes permiso para pagar esta solicitud' });
    }

    const preference = getPreferenceClient();
    const data = await preference.create({ body: construirPreferencePayload(solicitud) });
    await guardarPreferenciaSolicitud(solicitud.id_solicitud, data);

    return res.json({
      preference_id: data.id,
      id_preferencia: data.id,
      init_point: data.init_point,
      sandbox_init_point: data.sandbox_init_point
    });
  } catch (error) {
    const safeError = sanitizeMercadoPagoError(error);
    console.error('Error creando preferencia Mercado Pago:', safeError);
    res.status(error.statusCode || error.status || 500).json({
      message: safeError.message || 'Error al crear la preferencia de Mercado Pago',
      mercadoPago: safeError.cause ? { cause: safeError.cause } : undefined
    });
  }
});

// POST /api/mercadopago/webhook y /api/pagos/mercadopago/webhook
router.post('/webhook', async (req, res) => {
  const type = obtenerTipoWebhookMercadoPago(req);
  const paymentId = extraerPaymentIdMercadoPago(req);

  console.info('Webhook Mercado Pago recibido:', {
    type,
    id: paymentId ? String(paymentId) : null
  });

  if (paymentId) {
    try {
      const resultado = await procesarPagoMercadoPago(paymentId);
      console.info('Pago Mercado Pago procesado:', {
        id: resultado.payment_id,
        status: resultado.status,
        status_detail: resultado.status_detail,
        id_solicitud: resultado.solicitud?.id_solicitud || null,
        match: resultado.match || null,
        jsonActualizado: resultado.jsonActualizado || false,
        mysqlActualizado: resultado.mysqlActualizado || false
      });
    } catch (error) {
      console.warn('No fue posible procesar webhook Mercado Pago:', sanitizeMercadoPagoError(error));
    }
  }

  return res.sendStatus(200);
});

// GET /api/pagos/mercadopago/estado/:id_solicitud_pago
router.get('/estado/:id_solicitud_pago', authenticate, authorize([3]), async (req, res) => {
  try {
    const resultado = await obtenerSolicitudPago(req.params.id_solicitud_pago);
    if (!resultado) {
      return res.status(404).json({ message: 'Solicitud de pago no encontrada' });
    }

    let solicitud = resultado.solicitud;
    const autorizado = await validarPermisoCliente(solicitud, req);
    if (!autorizado) {
      return res.status(403).json({ message: 'No tienes permiso para consultar esta solicitud' });
    }

    solicitud = await sincronizarEstadoDesdeMercadoPago(solicitud);
    const estado = Number(solicitud.id_estado) === 2 ? 'pagado' : 'pendiente';
    const paymentId = solicitud.mercadopago_payment_id || solicitud.id_pago_mercadopago || null;

    return res.json({
      id_solicitud_pago: solicitud.id_solicitud,
      estado,
      estado_interno: estado,
      id_estado: solicitud.id_estado,
      pagado: estado === 'pagado',
      mercadopago_status: solicitud.mercadopago_status || null,
      mercadopago_status_detail: solicitud.mercadopago_status_detail || null,
      mercadopago_payment_id: paymentId,
      payment_id: paymentId,
      id_preferencia: solicitud.id_preferencia || solicitud.preference_id || null,
      pagada_en: solicitud.pagada_en || null,
      mensaje: construirMensajeEstado(solicitud),
      solicitud
    });
  } catch (error) {
    const safeError = sanitizeMercadoPagoError(error);
    console.error('Error consultando estado Mercado Pago:', safeError);
    res.status(error.statusCode || error.status || 500).json({ message: safeError.message || 'Error al consultar estado de pago' });
  }
});

// POST /api/pagos/mercadopago/confirmar
router.post('/confirmar', authenticate, authorize([3]), async (req, res) => {
  try {
    const { payment_id, id_solicitud, id_solicitud_pago } = req.body;
    const idSolicitud = id_solicitud || id_solicitud_pago;

    if (!payment_id && !idSolicitud) {
      return res.status(400).json({ message: 'payment_id o id_solicitud son obligatorios' });
    }

    let resultado;
    if (payment_id) {
      resultado = await procesarPagoMercadoPago(payment_id);
      if (!resultado.procesado && idSolicitud) {
        const fallback = await obtenerSolicitudPago(idSolicitud);
        if (fallback) {
          resultado.solicitud = fallback.solicitud;
        }
      }
    } else {
      const solicitudResultado = await obtenerSolicitudPago(idSolicitud);
      if (!solicitudResultado) {
        return res.status(404).json({ message: 'Solicitud de pago no encontrada' });
      }
      resultado = {
        procesado: true,
        status: solicitudResultado.solicitud.mercadopago_status || (Number(solicitudResultado.solicitud.id_estado) === 2 ? 'approved' : 'pending'),
        status_detail: solicitudResultado.solicitud.mercadopago_status_detail || null,
        solicitud: solicitudResultado.solicitud,
        payment_id: solicitudResultado.solicitud.mercadopago_payment_id || solicitudResultado.solicitud.id_pago_mercadopago || null,
        message: construirMensajeEstado(solicitudResultado.solicitud)
      };
    }

    if (!resultado.solicitud) {
      return res.status(404).json({ message: resultado.message || 'Solicitud de pago no encontrada' });
    }

    const autorizado = await validarPermisoCliente(resultado.solicitud, req);
    if (!autorizado) {
      return res.status(403).json({ message: 'No tienes permiso para confirmar esta solicitud' });
    }

    const httpStatus = resultado.status === 'approved' || Number(resultado.solicitud.id_estado) === 2 ? 200 : 202;
    return res.status(httpStatus).json({
      status: resultado.status,
      status_detail: resultado.status_detail,
      solicitud: resultado.solicitud,
      payment_id: resultado.payment_id || payment_id || null,
      id_preferencia: resultado.solicitud.id_preferencia || resultado.solicitud.preference_id || null,
      message: resultado.message || construirMensajeEstado(resultado.solicitud)
    });
  } catch (error) {
    const safeError = sanitizeMercadoPagoError(error);
    console.error('Error confirmando pago Mercado Pago:', safeError);
    res.status(error.statusCode || error.status || 500).json({ message: safeError.message || 'Error al confirmar el pago en Mercado Pago' });
  }
});

module.exports = router;
