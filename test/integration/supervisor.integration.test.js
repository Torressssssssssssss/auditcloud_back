const { describe: describir, it: probar } = require('node:test');
const afirmar = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { prepararAplicacion, crearFormulario, secreto } = require('./helpers/aislamiento');

function generarToken(rol, empresa = 11)
{
  return jwt.sign({ id_usuario: rol === 1 ? 5 : 9, id_empresa: empresa, id_rol: rol }, secreto, { expiresIn: '5m' });
}

describir('Integración HTTP en memoria: supervisores y Firebase', { concurrency: false }, () =>
{
  probar('rechaza con 403 el JWT de cliente antes de acceder a persistencia o Firebase', async prueba =>
  {
    const escenario = prepararAplicacion(prueba);
    const respuesta = await escenario.solicitar('POST', '/api/supervisor/reportes', {
      ...crearFormulario(), token: generarToken(3)
    });
    afirmar.equal(respuesta.estado, 403);
    afirmar.deepEqual(respuesta.cuerpo, { message: 'No tienes permiso para realizar esta acción' });
    afirmar.equal(escenario.pool.getConnection.mock.callCount(), 0);
    afirmar.equal(escenario.deposito.file.mock.callCount(), 0);
  });

  probar('acepta al supervisor, procesa multipart y guarda los bytes en Firebase simulado', async prueba =>
  {
    const escenario = prepararAplicacion(prueba);
    const formulario = crearFormulario();
    const respuesta = await escenario.solicitar('POST', '/api/supervisor/reportes', {
      ...formulario, token: generarToken(1)
    });
    afirmar.equal(respuesta.estado, 201);
    afirmar.equal(respuesta.cuerpo.message, 'Reporte subido correctamente');
    afirmar.deepEqual(Buffer.concat(escenario.fragmentos), formulario.pdf);
    afirmar.equal(escenario.archivoFirebase.makePublic.mock.callCount(), 1);
    afirmar.equal(escenario.deposito.file.mock.callCount(), 1);
    const [opciones] = escenario.archivoFirebase.createWriteStream.mock.calls[0].arguments;
    afirmar.equal(opciones.metadata.contentType, 'application/pdf');
    afirmar.equal(opciones.metadata.metadata.originalName, 'reporte.pdf');
    const reporte = respuesta.cuerpo.reporte;
    afirmar.equal(reporte.id_auditoria, 20);
    afirmar.equal(reporte.creado_por, 5);
    afirmar.match(reporte.url, /^https:\/\/storage.googleapis.com\/integracion.example.test\/reportes\/20\//);
    afirmar.deepEqual(escenario.tablas.reportes, [reporte]);
    afirmar.ok(escenario.cambios.some(sentencia => sentencia.startsWith('INSERT INTO `reportes`')));
    afirmar.equal(escenario.connection.commit.mock.callCount(), 1);
    afirmar.equal(escenario.connection.rollback.mock.callCount(), 0);
    afirmar.equal(escenario.connection.release.mock.callCount(), 1);
  });

  probar('rechaza la subida de un supervisor de otra empresa sin tocar Firebase', async prueba =>
  {
    const escenario = prepararAplicacion(prueba);
    const respuesta = await escenario.solicitar('POST', '/api/supervisor/reportes', {
      ...crearFormulario(), token: generarToken(1, 99)
    });
    afirmar.equal(respuesta.estado, 403);
    afirmar.equal(escenario.deposito.file.mock.callCount(), 0);
    afirmar.deepEqual(escenario.tablas.reportes, []);
    afirmar.equal(escenario.connection.rollback.mock.callCount(), 1);
  });

  probar('una excepción SQL no controlada devuelve 500 limpio y revierte la transacción', async prueba =>
  {
    const escenario = prepararAplicacion(prueba);
    escenario.connection.execute.mock.mockImplementation(async () =>
    {
      throw new Error('SELECT password_hash FROM usuarios; credencial_interna /servidor/privado');
    });
    const respuesta = await escenario.solicitar('POST', '/api/supervisor/reportes', {
      ...crearFormulario(), token: generarToken(1)
    });
    afirmar.equal(respuesta.estado, 500);
    afirmar.match(respuesta.tipo, /application\/json/);
    afirmar.deepEqual(respuesta.cuerpo, { message: 'No se pudo completar la operación' });
    afirmar.doesNotMatch(respuesta.texto, /stack|SELECT|password_hash|credencial_interna|servidor|node_modules/i);
    afirmar.equal(escenario.connection.commit.mock.callCount(), 0);
    afirmar.equal(escenario.connection.rollback.mock.callCount(), 1);
    afirmar.equal(escenario.connection.release.mock.callCount(), 1);
    afirmar.equal(escenario.deposito.file.mock.callCount(), 0);
    afirmar.equal(escenario.enviarCorreo.mock.callCount(), 0);
  });
});
