// Rutas de PayPal: crea y captura ordenes y actualiza solicitudes de pago.
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const { readJson } = require('../utils/jsonDb');
const { authenticate } = require('../utils/auth');
const { ensureAuditoriaAfterPayment, syncLegacyJsonAfterPayment } = require('../utils/auditoriaPayment.service');
const { syncAuditoria } = require('../utils/elasticsearchAuditorias.service');

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_API } = process.env;

async function getPayPalAccessToken() {
  const auth = Buffer.from(PAYPAL_CLIENT_ID + ':' + PAYPAL_CLIENT_SECRET).toString('base64');
  const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    body: 'grant_type=client_credentials',
    headers: {
      Authorization: `Basic ${auth}`
    }
  });
  const data = await response.json();
  return data.access_token;
}

// POST /api/paypal/create-order
router.post('/create-order', authenticate, async (req, res) => {
  const { id_solicitud } = req.body;
  const usuarioLogueado = req.user;

  const solicitudes = await readJson('solicitudes_pago.json');
  const solicitud = solicitudes.find(s => Number(s.id_solicitud) === Number(id_solicitud));

  if (!solicitud || Number(solicitud.id_estado) === 2) {
    return res.status(400).json({ message: 'Solicitud invalida o ya pagada' });
  }

  const esDuenoDirecto = Number(solicitud.id_cliente) === Number(usuarioLogueado.id_usuario);
  const esMismaEmpresa = solicitud.id_empresa_cliente
    ? Number(solicitud.id_empresa_cliente) === Number(usuarioLogueado.id_empresa)
    : false;

  if (!esDuenoDirecto && !esMismaEmpresa) {
    console.log(`Bloqueo 403: Usuario ${usuarioLogueado.id_usuario} (Empresa ${usuarioLogueado.id_empresa}) intento pagar solicitud de Usuario ${solicitud.id_cliente} (Empresa ${solicitud.id_empresa_cliente})`);
    return res.status(403).json({ message: 'No tienes permiso para pagar esta solicitud de otra empresa/usuario' });
  }

  try {
    const paypalToken = await getPayPalAccessToken();

    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${paypalToken}`
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: String(solicitud.id_solicitud),
          amount: {
            currency_code: 'MXN',
            value: String(solicitud.monto)
          }
        }]
      })
    });

    const order = await response.json();
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creando orden de PayPal');
  }
});

// POST /api/paypal/capture-order
router.post('/capture-order', authenticate, async (req, res) => {
  const { orderID } = req.body;

  try {
    const accessToken = await getPayPalAccessToken();
    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      }
    });

    const data = await response.json();

    if (data.status === 'COMPLETED') {
      const idSolicitudInterna = Number(data.purchase_units[0].reference_id);

      const resultado = await ensureAuditoriaAfterPayment(idSolicitudInterna, {
        pagadaEn: new Date(),
        paypalOrderId: orderID
      });

      await syncAuditoria(resultado.auditoria.id_auditoria);
      await syncLegacyJsonAfterPayment(resultado);

      return res.json({ status: 'COMPLETED', auditoria: resultado.auditoria });
    }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error capturando pago');
  }
});

module.exports = router;
