const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mockPersistence, assertCommitted, assertRolledBack } = require('./helpers/mysql');

function routeFixture(t, handler, options = {}) {
  const persistence = mockPersistence(t, options);
  const { transactionalRouter, events } = persistence;
  const last = { handle: handler };
  const router = { stack: [{ route: { stack: [last] } }] };
  const req = { method: 'POST', baseUrl: '/api/prueba' };
  const res = {
    statusCode: 200,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json: t.mock.fn(body => { events.push('response.json'); return res; }),
    send: t.mock.fn(body => { events.push('response.send'); return res; })
  };
  const json = res.json;
  const send = res.send;
  const next = t.mock.fn();
  const log = t.mock.method(console, 'error', () => {});
  assert.strictEqual(transactionalRouter(router), router);
  return { ...persistence, req, res, json, send, next, log,
    run: () => last.handle(req, res, next) };
}

describe('sqlRouter: respuestas después de persistir', { concurrency: false }, () => {
  it('confirma antes de enviar JSON, oculta contraseñas y restaura los métodos de respuesta', async t => {
    const body = { usuario: { id_usuario: 7, password_hash: 'hash', password: 'secreto' },
      miembros: [{ nombre: 'Otro', password: 'oculto' }] };
    const fixture = routeFixture(t, async (req, res) => {
      assert.equal(fixture.db.transactionContext.getStore().write, true);
      assert.strictEqual(res.status(201).json(body), res);
      assert.equal(fixture.json.mock.callCount(), 0);
      assert.equal(fixture.connection.commit.mock.callCount(), 0);
    });
    await fixture.run();
    assertCommitted(fixture.connection);
    assert.equal(fixture.res.statusCode, 201);
    assert.deepEqual(fixture.json.mock.calls[0].arguments,
      [{ usuario: { id_usuario: 7 }, miembros: [{ nombre: 'Otro' }] }]);
    assert.ok(fixture.events.indexOf('response.json') > fixture.events.indexOf('connection.commit'));
    assert.strictEqual(fixture.res.json, fixture.json);
    assert.strictEqual(fixture.res.send, fixture.send);
    assert.equal(body.usuario.password, 'secreto');
    assert.equal(fixture.log.mock.callCount(), 0);
  });

  it('espera al commit antes de enviar una respuesta con send', async t => {
    const fixture = routeFixture(t, async (req, res) => { res.send('operación completa'); });
    await fixture.run();
    assertCommitted(fixture.connection);
    assert.deepEqual(fixture.send.mock.calls[0].arguments, ['operación completa']);
    assert.equal(fixture.json.mock.callCount(), 0);
    assert.ok(fixture.events.indexOf('response.send') > fixture.events.indexOf('connection.commit'));
  });

  it('hace rollback para una respuesta 400 y conserva su cuerpo', async t => {
    const fixture = routeFixture(t, async (req, res) => { res.status(400).json({ message: 'Datos inválidos' }); });
    await fixture.run();
    assertRolledBack(fixture.connection);
    assert.equal(fixture.connection.commit.mock.callCount(), 0);
    assert.equal(fixture.res.statusCode, 400);
    assert.deepEqual(fixture.json.mock.calls[0].arguments, [{ message: 'Datos inválidos' }]);
    assert.ok(fixture.events.indexOf('response.json') > fixture.events.indexOf('connection.rollback'));
    assert.equal(fixture.log.mock.callCount(), 0);
  });

  it('sustituye el éxito provisional por un 500 si falla el commit', async t => {
    const error = Object.assign(new Error('detalle privado'), { code: 'ER_LOCK_DEADLOCK' });
    const fixture = routeFixture(t, async (req, res) => { res.status(201).json({ ok: true }); }, { commitError: error });
    await fixture.run();
    assertRolledBack(fixture.connection);
    assert.equal(fixture.res.statusCode, 500);
    assert.equal(fixture.json.mock.callCount(), 1);
    assert.deepEqual(fixture.json.mock.calls[0].arguments, [{ message: 'No se pudo completar la operación' }]);
    assert.deepEqual(fixture.log.mock.calls[0].arguments, ['[MySQL operation failed]', 'ER_LOCK_DEADLOCK']);
    assert.strictEqual(fixture.res.json, fixture.json);
    assert.strictEqual(fixture.res.send, fixture.send);
  });

  it('convierte un conflicto optimista en 409, revierte y no expone el error interno', async t => {
    const fixture = routeFixture(t, async () => {
      throw Object.assign(new Error('Concurrent update: detalle privado'), { statusCode: 409 });
    });
    await fixture.run();
    assertRolledBack(fixture.connection);
    assert.equal(fixture.connection.commit.mock.callCount(), 0);
    assert.equal(fixture.res.statusCode, 409);
    assert.deepEqual(fixture.json.mock.calls[0].arguments,
      [{ message: 'Los datos cambiaron; vuelve a intentar.' }]);
  });

  it('responde 503 cuando MySQL no concede el bloqueo de escritura', async t => {
    const handler = t.mock.fn(async () => {});
    const fixture = routeFixture(t, handler, { acquired: 0 });
    await fixture.run();
    assert.equal(handler.mock.callCount(), 0);
    assert.equal(fixture.res.statusCode, 503);
    assert.deepEqual(fixture.json.mock.calls[0].arguments, [{ message: 'No se pudo completar la operación' }]);
    assertRolledBack(fixture.connection);
  });

  for (const method of ['GET', 'HEAD']) {
    it(`ejecuta ${method} como transacción de lectura sin bloqueo de escritura`, async t => {
      const fixture = routeFixture(t, async (req, res) => {
        assert.equal(fixture.db.transactionContext.getStore().write, false);
        res.json({ ok: true });
      });
      fixture.req.method = method;
      await fixture.run();
      assert.equal(fixture.connection.query.mock.callCount(), 0);
      assertCommitted(fixture.connection);
    });
  }

  it('trata GET de mercadopago como escritura', async t => {
    const fixture = routeFixture(t, async (req, res) => {
      assert.equal(fixture.db.transactionContext.getStore().write, true);
      res.json({ ok: true });
    });
    fixture.req.method = 'GET';
    fixture.req.baseUrl = '/api/mercadopago';
    await fixture.run();
    assert.equal(fixture.connection.query.mock.callCount(), 2);
    assertCommitted(fixture.connection);
  });

  it('no envía una respuesta duplicada si las cabeceras ya se enviaron', async t => {
    const fixture = routeFixture(t, async (req, res) => {
      res.json({ ok: true });
      res.headersSent = true;
    });
    await fixture.run();
    assertCommitted(fixture.connection);
    assert.equal(fixture.json.mock.callCount(), 0);
    assert.equal(fixture.send.mock.callCount(), 0);
  });

  it('permite handlers sin cuerpo y conserva el argumento next', async t => {
    const fixture = routeFixture(t, async (req, res, next) => { next(); });
    await fixture.run();
    assert.equal(fixture.next.mock.callCount(), 1);
    assert.equal(fixture.json.mock.callCount(), 0);
    assert.equal(fixture.send.mock.callCount(), 0);
    assertCommitted(fixture.connection);
  });

  it('deja intactos middleware, handlers síncronos y handlers anteriores al último', t => {
    const { transactionalRouter, createPool } = mockPersistence(t);
    const middleware = { handle() {} };
    const previous = { handle: async () => {} };
    const last = { handle() {} };
    const previousHandle = previous.handle;
    const lastHandle = last.handle;
    const router = { stack: [middleware, { route: { stack: [previous, last] } }] };
    transactionalRouter(router);
    assert.strictEqual(router.stack[0], middleware);
    assert.strictEqual(previous.handle, previousHandle);
    assert.strictEqual(last.handle, lastHandle);
    assert.equal(createPool.mock.callCount(), 0);
  });
});
