const { describe: describir, it: probar } = require('node:test');
const afirmar = require('node:assert/strict');
const { prepararAplicacion } = require('./helpers/aislamiento');

describir('Integración HTTP en memoria: webhooks de pago', { concurrency: false }, () =>
{
  probar('confirma el pago, persiste la auditoría y envía correo después del commit', async prueba =>
  {
    const escenario = prepararAplicacion(prueba);
    const confirmaciones = [];
    escenario.enviarCorreo.mock.mockImplementation(async () =>
    {
      confirmaciones.push(escenario.connection.commit.mock.callCount());
      return { messageId: 'confirmacion' };
    });
    const respuesta = await escenario.solicitar('POST', '/api/pagos/mercadopago/webhook', {
      cuerpo: { type: 'payment', data: { id: 123 } }
    });
    afirmar.equal(respuesta.estado, 200);
    afirmar.equal(respuesta.cuerpo, 'OK');
    afirmar.deepEqual(escenario.obtenerPago.mock.calls[0].arguments, [{ id: '123' }]);
    afirmar.equal(escenario.tablas.solicitudes_pago[0].id_estado, 2);
    afirmar.equal(escenario.tablas.solicitudes_pago[0].mercadopago_payment_id, '123');
    afirmar.ok(escenario.cambios.some(sentencia => sentencia.startsWith('UPDATE `solicitudes_pago`')));
    afirmar.equal(escenario.tablas.auditorias.filter(fila => fila.id_solicitud_pago === 7).length, 1);
    afirmar.equal(escenario.enviarCorreo.mock.callCount(), 1);
    afirmar.deepEqual(confirmaciones, [1], 'El correo se envía después del commit');
    const [correo] = escenario.enviarCorreo.mock.calls[0].arguments;
    afirmar.equal(correo.to, 'cliente@example.test');
    afirmar.match(correo.subject, /Pago confirmado/);
    afirmar.match(correo.html, /solicitud #7/);
    afirmar.equal(escenario.connection.rollback.mock.callCount(), 0);
    afirmar.equal(escenario.connection.release.mock.callCount(), 1);

    const reintento = await escenario.solicitar('POST', '/api/mercadopago/webhook?data.id=123', { cuerpo: {} });
    afirmar.equal(reintento.estado, 200);
    afirmar.equal(escenario.tablas.auditorias.filter(fila => fila.id_solicitud_pago === 7).length, 1);
    afirmar.equal(escenario.enviarCorreo.mock.callCount(), 1, 'No duplica la confirmación');
  });

  probar('acepta una notificación sin identificador sin modificar datos ni enviar correo', async prueba =>
  {
    const escenario = prepararAplicacion(prueba);
    const respuesta = await escenario.solicitar('POST', '/api/pagos/mercadopago/webhook', { cuerpo: { type: 'payment' } });
    afirmar.equal(respuesta.estado, 200);
    afirmar.equal(escenario.obtenerPago.mock.callCount(), 0);
    afirmar.deepEqual(escenario.cambios, []);
    afirmar.equal(escenario.enviarCorreo.mock.callCount(), 0);
  });

  probar('un pago pendiente no genera auditoría ni correo de confirmación', async prueba =>
  {
    const escenario = prepararAplicacion(prueba);
    escenario.pago.status = 'pending';
    const respuesta = await escenario.solicitar('POST', '/api/pagos/mercadopago/webhook', { cuerpo: { data: { id: 123 } } });
    afirmar.equal(respuesta.estado, 200);
    afirmar.equal(escenario.tablas.solicitudes_pago[0].id_estado, 1);
    afirmar.equal(escenario.tablas.auditorias.length, 1);
    afirmar.equal(escenario.enviarCorreo.mock.callCount(), 0);
  });

  probar('el manejador global devuelve JSON genérico para un JSON sintácticamente inválido', async prueba =>
  {
    const escenario = prepararAplicacion(prueba);
    const respuesta = await escenario.solicitar('POST', '/api/pagos/mercadopago/webhook', {
      contenido: '{"secreto_interno":"no_divulgar",'
    });
    afirmar.equal(respuesta.estado, 400);
    afirmar.match(respuesta.tipo, /application\/json/);
    afirmar.deepEqual(respuesta.cuerpo, { message: 'JSON inválido' });
    afirmar.doesNotMatch(respuesta.texto, /stack|SyntaxError|secreto_interno|no_divulgar|node_modules/i);
    afirmar.equal(escenario.pool.getConnection.mock.callCount(), 0);
    afirmar.equal(escenario.obtenerPago.mock.callCount(), 0);
    afirmar.equal(escenario.enviarCorreo.mock.callCount(), 0);
  });
});
