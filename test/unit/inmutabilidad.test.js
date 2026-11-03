const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mockPersistence } = require('./helpers/mysql');

function prepararRegla(prueba, estado = 3)
{
  const consultas = [];
  const persistencia = mockPersistence(prueba, {
    execute(sentencia, parametros)
    {
      consultas.push({ sentencia, parametros });
      assert.ok(persistencia.db.transactionContext.getStore()?.write);
      return [{ id_auditoria: 20, id_estado: estado }];
    }
  });
  const ruta = require.resolve('../../middleware/verificarInmutabilidad');
  const anterior = require.cache[ruta];
  delete require.cache[ruta];
  prueba.after(() =>
  {
    delete require.cache[ruta];
    if(anterior) require.cache[ruta] = anterior;
  });
  const { verificarInmutabilidad } = require(ruta);
  const solicitud = { method: 'PUT', route: { path: '/auditorias/:idAuditoria/estado' },
    params: { idAuditoria: '20' }, user: { id_rol: 1, id_empresa: 11 }, body: { id_estado: 1 } };
  return { ...persistencia, verificarInmutabilidad, consultas, solicitud };
}

describe('AC-06: bloqueo transaccional y resolución del expediente', { concurrency: false }, () =>
{
  it('consulta el estado persistido con FOR UPDATE aunque el cliente indique que sigue abierta', async prueba =>
  {
    const escenario = prepararRegla(prueba);
    await assert.rejects(escenario.db.withTransaction(() => escenario.verificarInmutabilidad(escenario.solicitud)),
      error => error.statusCode === 409 && error.code === 'AUDITORIA_FINALIZADA');
    assert.match(escenario.consultas[0].sentencia, /FOR UPDATE$/);
    assert.deepEqual(escenario.consultas[0].parametros, [20, 11]);
    assert.equal(escenario.connection.commit.mock.callCount(), 0);
    assert.equal(escenario.connection.rollback.mock.callCount(), 1);
    assert.ok(escenario.events.indexOf('connection.begin') < escenario.events.indexOf('connection.execute'));
  });
  it('resuelve la auditoría de la evidencia por FK y no por el cuerpo manipulable', async prueba =>
  {
    const escenario = prepararRegla(prueba);
    Object.assign(escenario.solicitud, { route: { path: '/evidencias/:idEvidencia' },
      params: { idEvidencia: '70' }, body: { id_auditoria: 99 } });
    await assert.rejects(escenario.db.withTransaction(() => escenario.verificarInmutabilidad(escenario.solicitud)));
    assert.match(escenario.consultas[0].sentencia, /JOIN evidencias e ON e.id_auditoria=a.id_auditoria/);
    assert.deepEqual(escenario.consultas[0].parametros, [70, 11]);
  });
  it('rechaza usar la regla fuera de una transacción sin ejecutar SQL', async prueba =>
  {
    const escenario = prepararRegla(prueba);
    await assert.rejects(escenario.verificarInmutabilidad(escenario.solicitud), /transacción de escritura/);
    assert.equal(escenario.consultas.length, 0);
  });
  it('omite las lecturas y valida los identificadores antes de consultar', async prueba =>
  {
    const escenario = prepararRegla(prueba);
    await escenario.verificarInmutabilidad({ ...escenario.solicitud, method: 'GET' });
    escenario.solicitud.params.idAuditoria = '20 OR 1=1';
    await assert.rejects(escenario.db.withTransaction(() => escenario.verificarInmutabilidad(escenario.solicitud)),
      error => error.statusCode === 400);
    assert.equal(escenario.consultas.length, 0);
  });
  it('no invoca el controlador ni confirma cuando la verificación detecta un cierre', async prueba =>
  {
    const escenario = prepararRegla(prueba);
    const controlador = prueba.mock.fn(async () => 
{});
    const ultimo = { handle: controlador };
    const rutas = { stack: [{ route: { stack: [ultimo] } }] };
    const json = prueba.mock.fn();
    const respuesta = { statusCode: 200, headersSent: false, json, send: prueba.mock.fn() };
    escenario.transactionalRouter(rutas, { verificarEscritura: escenario.verificarInmutabilidad });
    await ultimo.handle(escenario.solicitud, respuesta, prueba.mock.fn());
    assert.equal(controlador.mock.callCount(), 0);
    assert.equal(respuesta.statusCode, 409);
    assert.equal(json.mock.calls[0].arguments[0].code, 'AUDITORIA_FINALIZADA');
    assert.equal(escenario.connection.rollback.mock.callCount(), 1);
  });
});
