const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { mockPersistence } = require('./helpers/mysql');
const { isolateExternals } = require('./helpers/externalIsolation');

function prepararConexion(prueba, { activo = true } = {})
{
  isolateExternals(prueba, { JWT_SECRET: 'secreto_exclusivo_pruebas_socket' });
  const consultas = [];
  const persistencia = mockPersistence(prueba, {
    execute(sentencia, parametros)
    {
      consultas.push({ sentencia, parametros });
      return activo ? [{ id_usuario: 5 }] : [];
    }
  });
  const ruta = require.resolve('../../services/websocket.service');
  const anterior = require.cache[ruta];
  delete require.cache[ruta];
  prueba.after(() =>
  {
    delete require.cache[ruta];
    if(anterior) require.cache[ruta] = anterior;
  });
  const servicio = require(ruta);
  const emitir = prueba.mock.fn();
  const sala = prueba.mock.fn(() => ({ emit: emitir }));
  const aplicacion = { get: prueba.mock.fn(() => ({ to: sala })) };
  const firmar = (datos = {}) => jwt.sign({ id_usuario: 5, id_empresa: 11, id_rol: 1, ...datos },
    'secreto_exclusivo_pruebas_socket', { expiresIn: '1h' });
  return { ...persistencia, consultas, servicio, emitir, sala, aplicacion, firmar };
}

describe('AC-04: seguridad y publicación de sockets', { concurrency: false }, () =>
{
  it('solo acepta supervisores activos y conserva la empresa de la identidad verificada', async prueba =>
  {
    const escenario = prepararConexion(prueba);
    const conexion = { handshake: { auth: { token: escenario.firmar() } }, data: {} };
    const siguiente = prueba.mock.fn();
    await escenario.servicio.autenticarConexion(conexion, siguiente);
    assert.deepEqual(siguiente.mock.calls[0].arguments, []);
    assert.equal(conexion.data.usuario.id_empresa, 11);
    assert.deepEqual(escenario.consultas[0].parametros, [5, 11]);
    assert.match(escenario.consultas[0].sentencia, /id_rol=1 AND activo=1/);
  });
  it('rechaza otros roles, empresas inválidas y tokens manipulados antes de consultar SQL', async prueba =>
  {
    const escenario = prepararConexion(prueba);
    for(const token of [undefined, 'manipulado', escenario.firmar({ id_rol: 2 }), escenario.firmar({ id_empresa: null })])
    {
      const siguiente = prueba.mock.fn();
      await escenario.servicio.autenticarConexion({ handshake: { auth: { token } }, data: {} }, siguiente);
      assert.match(siguiente.mock.calls[0].arguments[0].message, /no autorizado/);
    }
    assert.equal(escenario.consultas.length, 0);
  });
  it('rechaza cuentas desactivadas aunque el JWT esté vigente', async prueba =>
  {
    const escenario = prepararConexion(prueba, { activo: false });
    const siguiente = prueba.mock.fn();
    await escenario.servicio.autenticarConexion({ handshake: { auth: { token: escenario.firmar() } }, data: {} }, siguiente);
    assert.ok(siguiente.mock.calls[0].arguments[0] instanceof Error);
  });
  it('emite nuevo_consumo después del commit a una sala aislada por empresa', async prueba =>
  {
    const escenario = prepararConexion(prueba);
    const consumo = { id_evidencia: 8, tipo_recurso: 'Agua', cantidad: '1.000' };
    await escenario.db.withTransaction(async () =>
    {
      escenario.servicio.programarNuevoConsumo(escenario.aplicacion, 11, consumo);
      assert.equal(escenario.emitir.mock.callCount(), 0);
    });
    await new Promise(resolver => setImmediate(resolver));
    assert.equal(escenario.connection.commit.mock.callCount(), 1);
    assert.deepEqual(escenario.sala.mock.calls[0].arguments, ['direccion:empresa:11']);
    assert.deepEqual(escenario.emitir.mock.calls[0].arguments, ['nuevo_consumo', consumo]);
  });
  it('no publica cuando la transacción se revierte', async prueba =>
  {
    const escenario = prepararConexion(prueba);
    await assert.rejects(escenario.db.withTransaction(async () =>
    {
      escenario.servicio.programarNuevoConsumo(escenario.aplicacion, 11, { id_evidencia: 8 });
      throw new Error('Fallo de operación');
    }));
    await new Promise(resolver => setImmediate(resolver));
    assert.equal(escenario.emitir.mock.callCount(), 0);
  });
});
