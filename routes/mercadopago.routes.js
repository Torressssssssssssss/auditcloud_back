// Rutas de Mercado Pago Checkout Pro: crear preferencias y confirmar pagos.
const express = require('express');
const router = express.Router();

const { query } = require('../utils/db');
const { readJson, writeJson } = require('../utils/jsonDb');
const { authenticate, authorize } = require('../utils/auth');

const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const MERCADOPAGO_API = process.env.MERCADOPAGO_API || 'https://api.mercadopago.com';
const frontendUrl = String(process.env.FRONTEND_URL || 'http://localhost:4200')
  .trim()
  .replace(/^['"]|['"]$/g, '')
  .replace(/\/$/, '');

function construirBackUrls(baseUrl) {
  const fallback = 'http://localhost:4200';
  const base = String(baseUrl || fallback).trim().replace(/\/$/, '') || fallback;

  const success = `${base}/cliente/pagos?status=success`;
  const failure = `${base}/cliente/pagos?status=failure`;
  const pending = `${base}/cliente/pagos?status=pending`;

  return {
    success,
    failure,
    pending
  };
}

function esUrlPublicaNoLocal(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    const host = String(parsed.hostname || '').toLowerCase();
    return parsed.protocol === 'https:' && host !== 'localhost' && host !== '127.0.0.1';
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

async function obtenerSolicitudPago(idSolicitud) {
  const idBuscado = Number(idSolicitud);
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

async function validarPermisoCliente(solicitud, req) {
  const idUsuario = Number(req.user.id_usuario);
  const idEmpresa = Number(req.user.id_empresa);

  return Number(solicitud.id_cliente) === idUsuario || Number(solicitud.id_empresa_cliente) === idEmpresa;
}

async function obtenerPaymentMercadoPago(paymentId) {
  if (!MERCADOPAGO_ACCESS_TOKEN) {
    return null;
  }

  const response = await fetch(`${MERCADOPAGO_API}/v1/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`
    }
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.message || data?.error || 'No fue posible consultar el pago en Mercado Pago';
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return data;
}

// POST /api/pagos/mercadopago/preferencia
router.post('/preferencia', authenticate, authorize([3]), async (req, res) => {
  try {
    const { id_solicitud } = req.body;

    if (!id_solicitud) {
      return res.status(400).json({ message: 'id_solicitud es obligatorio' });
    }

    if (!MERCADOPAGO_ACCESS_TOKEN) {
      return res.status(500).json({ message: 'Mercado Pago no está configurado en el servidor' });
    }

    const resultado = await obtenerSolicitudPago(id_solicitud);
    if (!resultado) {
      return res.status(404).json({ message: 'Solicitud de pago no encontrada' });
    }

    const solicitud = resultado.solicitud;

    if (!esSolicitudPendiente(solicitud)) {
      return res.status(400).json({ message: 'La solicitud ya fue pagada o no está pendiente' });
    }

    const autorizado = await validarPermisoCliente(solicitud, req);
    if (!autorizado) {
      return res.status(403).json({ message: 'No tienes permiso para pagar esta solicitud' });
    }

    const backUrls = construirBackUrls(frontendUrl);

    const preferencePayload = {
      items: [
        {
          title: String(solicitud.concepto || 'Solicitud de pago'),
          quantity: 1,
          unit_price: Number(solicitud.monto),
          currency_id: 'MXN'
        }
      ],
      external_reference: String(solicitud.id_solicitud),
      back_urls: backUrls
    };

    if (backUrls.success && esUrlPublicaNoLocal(frontendUrl)) {
      preferencePayload.auto_return = 'approved';
    }

    const response = await fetch(`${MERCADOPAGO_API}/checkout/preferences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`
      },
      body: JSON.stringify(preferencePayload)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        message: data?.message || data?.error || 'No fue posible crear la preferencia de Mercado Pago'
      });
    }

    return res.json({
      id_preferencia: data.id,
      init_point: data.init_point,
      sandbox_init_point: data.sandbox_init_point
    });
  } catch (error) {
    console.error('Error creando preferencia Mercado Pago:', error);
    res.status(500).json({ message: error.message || 'Error al crear la preferencia de Mercado Pago' });
  }
});

// POST /api/pagos/mercadopago/confirmar
router.post('/confirmar', authenticate, authorize([3]), async (req, res) => {
  try {
    const { payment_id, id_solicitud } = req.body;

    if (!payment_id && !id_solicitud) {
      return res.status(400).json({ message: 'payment_id o id_solicitud son obligatorios' });
    }

    if (!MERCADOPAGO_ACCESS_TOKEN) {
      return res.status(500).json({ message: 'Mercado Pago no está configurado en el servidor' });
    }

    const paymentData = payment_id ? await obtenerPaymentMercadoPago(payment_id) : null;
    const referencia = Number(paymentData?.external_reference || id_solicitud);

    const resultado = await obtenerSolicitudPago(referencia);
    if (!resultado) {
      return res.status(404).json({ message: 'Solicitud de pago no encontrada' });
    }

    const solicitud = resultado.solicitud;

    if (Number(solicitud.id_estado) === 2) {
      return res.json({
        status: 'approved',
        solicitud,
        message: 'La solicitud ya estaba pagada'
      });
    }

    const autorizado = await validarPermisoCliente(solicitud, req);
    if (!autorizado) {
      return res.status(403).json({ message: 'No tienes permiso para confirmar esta solicitud' });
    }

    if (paymentData && paymentData.status !== 'approved') {
      return res.status(400).json({
        message: 'El pago todavía no está aprobado en Mercado Pago',
        status: paymentData.status,
        solicitud
      });
    }

    const solicitudPagada = {
      ...solicitud,
      id_estado: 2,
      pagada_en: new Date().toISOString(),
      mercadopago_payment_id: paymentData?.id || null
    };

    await guardarSolicitudPagada(solicitudPagada);

    return res.json({
      status: 'approved',
      solicitud: solicitudPagada,
      payment_id: paymentData?.id || payment_id || null
    });
  } catch (error) {
    console.error('Error confirmando pago Mercado Pago:', error);
    res.status(500).json({ message: error.message || 'Error al confirmar el pago en Mercado Pago' });
  }
});

module.exports = router;