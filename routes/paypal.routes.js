// Rutas de PayPal: crea y captura ordenes y actualiza solicitudes de pago.
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch'); // Necesitas instalar: npm install node-fetch
const { readJson, writeJson, getNextId } = require('../utils/jsonDb');
const { authenticate } = require('../utils/auth');
const { indexAuditoria } = require('../services/elasticsearchAuditorias.service');

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_API } = process.env;

// Función auxiliar para obtener token de acceso de PayPal
async function getPayPalAccessToken() {
  const auth = Buffer.from(PAYPAL_CLIENT_ID + ':' + PAYPAL_CLIENT_SECRET).toString('base64');
  const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    body: 'grant_type=client_credentials',
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });
  const data = await response.json();
  return data.access_token;
}

// 1. CREAR ORDEN (El frontend llama a esto cuando dan click en "Pagar")
router.post('/create-order', authenticate, async (req, res) => {
  const { id_solicitud } = req.body;
  const usuarioLogueado = req.user; // Obtenemos todo el objeto usuario
  
  const solicitudes = await readJson('solicitudes_pago.json');
  const solicitud = solicitudes.find(s => s.id_solicitud === id_solicitud);

  if (!solicitud || solicitud.id_estado === 2) { 
    return res.status(400).json({ message: 'Solicitud inválida o ya pagada' });
  }

  const esDueñoDirecto = solicitud.id_cliente === usuarioLogueado.id_usuario;
  
  // Verificamos si la solicitud tiene el campo nuevo 'id_empresa_cliente'
  // Si no lo tiene (solicitudes viejas), comparamos id_empresa del usuario con la solicitud
  const esMismaEmpresa = solicitud.id_empresa_cliente 
    ? solicitud.id_empresa_cliente === usuarioLogueado.id_empresa
    : false; // Si no hay campo empresa, nos basamos solo en el usuario

  if (!esDueñoDirecto && !esMismaEmpresa) {
    console.log(`Bloqueo 403: Usuario ${usuarioLogueado.id_usuario} (Empresa ${usuarioLogueado.id_empresa}) intentó pagar solicitud de Usuario ${solicitud.id_cliente} (Empresa ${solicitud.id_empresa_cliente})`);
    return res.status(403).json({ message: 'No tienes permiso para pagar esta solicitud de otra empresa/usuario' });
  }

  try {
    // Aquí obtenemos el token DE PAYPAL (Server-to-Server)
    const paypalToken = await getPayPalAccessToken(); 
    
    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Aquí se usa el token de PAYPAL
        Authorization: `Bearer ${paypalToken}`, 
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: solicitud.id_solicitud.toString(), // Ligamos la orden a tu ID interno
          amount: {
            currency_code: 'MXN', // O 'USD' según tu config
            value: solicitud.monto.toString(),
          },
        }],
      }),
    });

    const order = await response.json();
    res.json(order); // Devolvemos el ID de orden de PayPal al frontend
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creando orden de PayPal');
  }
});

// 2. CAPTURAR ORDEN (Aquí sucede la MAGIA de tu negocio)
router.post('/capture-order', authenticate, async (req, res) => {
  const { orderID } = req.body; // El ID que nos dio PayPal en el paso anterior

  try {
    const accessToken = await getPayPalAccessToken();
    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const data = await response.json();

    if (data.status === 'COMPLETED') {
      // === AQUÍ ACTUALIZAMOS TU JSON DB ===
      // Obtenemos el ID de tu solicitud que guardamos en reference_id
      const idSolicitudInterna = Number(data.purchase_units[0].reference_id);
      
      const solicitudes = await readJson('solicitudes_pago.json');
      const auditorias = await readJson('auditorias.json');

      const idx = solicitudes.findIndex(s => s.id_solicitud === idSolicitudInterna);
      if (idx !== -1 && solicitudes[idx].id_estado !== 2) {
        
        // 1. Actualizar Solicitud a PAGADA
        solicitudes[idx].id_estado = 2; //
        solicitudes[idx].pagada_en = new Date().toISOString();
        solicitudes[idx].paypal_order_id = orderID; // Guardamos referencia
        await writeJson('solicitudes_pago.json', solicitudes);

        // 2. Crear la Auditoría (Activar el servicio)
        const nuevaAuditoria = {
          id_auditoria: await getNextId('auditorias.json', 'id_auditoria'),
          id_empresa_auditora: solicitudes[idx].id_empresa_auditora || solicitudes[idx].id_empresa,
          id_cliente: solicitudes[idx].id_cliente,
          id_solicitud_pago: solicitudes[idx].id_solicitud,
          id_estado: 1, // CREADA
          monto: solicitudes[idx].monto,
          creada_en: new Date().toISOString()
        };
        
        auditorias.push(nuevaAuditoria);
        await writeJson('auditorias.json', auditorias);
        // Elasticsearch es copia para visualizacion; si falla, no revierte la operacion principal.
        await indexAuditoria(nuevaAuditoria);

        return res.json({ status: 'COMPLETED', auditoria: nuevaAuditoria });
      }
    }
    
    res.json(data); // Si no se completó o ya estaba pagada
  } catch (err) {
    console.error(err);
    res.status(500).send('Error capturando pago');
  }
});

module.exports = router;