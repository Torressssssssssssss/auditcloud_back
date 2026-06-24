# Mercado Pago Checkout Pro - Ambiente de desarrollo

Esta integracion usa el SDK oficial `mercadopago` para Node.js.

## Credenciales de prueba

- Usar `MERCADOPAGO_ACCESS_TOKEN` del **Seller Test User**.
- Pagar con un **Buyer Test User** diferente.
- No mezclar cuenta real con cuenta de prueba.
- No guardar ni pegar tokens en documentacion, commits, tickets o logs.

## Tarjeta de prueba

Para pagos aprobados en pruebas, Mercado Pago documenta el uso de tarjetas de prueba con resultado `APRO`. Usa los datos vigentes desde Mercado Pago Developers para Mexico y Checkout Pro.

## Endpoints AuditCloud

Backend estable:

```bash
curl http://127.0.0.1:3000/api/mercadopago/status
```

Ruta compatible existente:

```bash
curl http://127.0.0.1:3000/api/pagos/mercadopago/status
```

Crear preferencia requiere JWT de usuario Cliente y una solicitud pendiente:

```bash
curl -X POST http://127.0.0.1:3000/api/mercadopago/preferencia \
  -H "Authorization: Bearer <JWT_CLIENTE>" \
  -H "Content-Type: application/json" \
  -d '{"id_solicitud_pago": 1}'
```

El backend devuelve:

- `preference_id`
- `init_point`
- `sandbox_init_point` si Mercado Pago lo entrega

Para pruebas, el frontend debe redirigir a `sandbox_init_point` cuando exista.

## URLs de retorno

El backend usa `FRONTEND_URL` para `back_urls`:

- success: `/cliente/pagos?status=success`
- failure: `/cliente/pagos?status=failure`
- pending: `/cliente/pagos?status=pending`

Si `FRONTEND_URL` es una IP LAN, sirve para pruebas dentro de la red local. Para pruebas fuera de la red o webhooks reales, se necesita una URL publica HTTPS.

## Webhook

Endpoint:

```bash
POST /api/mercadopago/webhook
```

En una VM local con IP LAN, Mercado Pago no podra llamar el webhook desde internet. Para probar webhooks reales se requiere dominio publico HTTPS o tunel controlado de pruebas. El webhook actual recibe la notificacion, loguea tipo/id de forma segura y puede consultar `Payment` con el SDK cuando llega un payment id.

## Checklist de prueba

1. Confirmar que `MERCADOPAGO_ACCESS_TOKEN` sea del Seller Test User.
2. Confirmar que `FRONTEND_URL` apunte al frontend que se va a probar.
3. Iniciar sesion como cliente en AuditCloud.
4. Usar una solicitud de pago pendiente.
5. Crear preferencia desde el frontend o con curl autenticado.
6. Redirigir al checkout usando `sandbox_init_point` si existe.
7. Pagar con Buyer Test User y tarjeta de prueba `APRO`.
8. Verificar retorno a `/cliente/pagos`.
