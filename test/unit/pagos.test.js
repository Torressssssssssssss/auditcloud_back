const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isolateExternals } = require('./helpers/externalIsolation');
const { mockPersistence, assertCommitted } = require('./helpers/mysql');

function fixture(t, paymentOverrides = {}) {
  const { replace } = isolateExternals(t, {
    MERCADOPAGO_ACCESS_TOKEN: 'TEST-token-sin-validez', FRONTEND_URL: 'https://frontend.example.test'
  });
  const payment = { id: 123, status: 'approved', status_detail: 'accredited',
    transaction_amount: 1000, currency_id: 'MXN', external_reference: '7', ...paymentOverrides };
  const get = t.mock.fn(async () => structuredClone(payment));
  const create = t.mock.fn(async () => ({ id: 'pref-test', init_point: 'https://checkout.example.test' }));
  replace('mercadopago', {
    MercadoPagoConfig: t.mock.fn(function (config) { this.config = config; }),
    Payment: t.mock.fn(function () { this.get = get; }),
    Preference: t.mock.fn(function () { this.create = create; })
  });
  const persistence = mockPersistence(t, {
    execute(sql, params) {
      assert.equal(sql, 'SELECT * FROM solicitudes_pago WHERE id_solicitud=?');
      return structuredClone(tables.solicitudes_pago.filter(row => row.id_solicitud === params[0]));
    }
  });
  const tables = { solicitudes_pago: [{ id_solicitud: 7, id_estado: 1, monto: 1000,
    id_cliente: 9, id_empresa_cliente: 10, id_empresa_auditora: 11, concepto: 'Auditoría ambiental' }], auditorias: [] };
  t.mock.method(persistence.store, 'listRows', async table => {
    assert.ok(Object.hasOwn(tables, table));
    return structuredClone(tables[table]);
  });
  const save = t.mock.method(persistence.store, 'saveRows', async (table, rows) => {
    assert.ok(Object.hasOwn(tables, table));
    tables[table] = structuredClone(rows);
  });
  t.mock.method(persistence.store, 'nextId', async table => {
    assert.equal(table, 'auditorias');
    return tables.auditorias.length + 1;
  });
  const router = require('../../routes/mercadopago.routes');
  async function run(path, body = {}, query = {}, method = 'post') {
    const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]);
    assert.ok(route);
    const res = { statusCode: 200, headersSent: false,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
      send(value) { this.body = value; return this; },
      sendStatus(code) { return this.status(code).send(String(code)); } };
    // Se invoca el handler transaccional real, sin abrir servidor HTTP.
    await route.route.stack.at(-1).handle({ method: method.toUpperCase(), baseUrl: '/api/mercadopago',
      body, query, params: { id_solicitud_pago: '7' }, user: { id_usuario: 9, id_empresa: 10 } }, res);
    return res;
  }
  return { ...persistence, tables, get, create, save, run };
}

describe('Pagos: Mercado Pago aislado', { concurrency: false }, () => {
  it('webhook aprobado marca pagado, crea auditoría y tolera reintentos', async t => {
    const f = fixture(t);
    assert.equal((await f.run('/webhook', { type: 'payment', data: { id: 123 } })).statusCode, 200);
    assertCommitted(f.connection);
    assert.deepEqual(f.get.mock.calls[0].arguments, [{ id: '123' }]);
    const paid = f.tables.solicitudes_pago[0];
    assert.equal(paid.id_estado, 2);
    assert.equal(paid.mercadopago_status, 'approved');
    assert.equal(paid.mercadopago_payment_id, '123');
    assert.ok(Number.isFinite(Date.parse(paid.pagada_en)));
    assert.equal(f.tables.auditorias.length, 1);
    assert.equal(f.tables.auditorias[0].id_solicitud_pago, 7);
    assert.equal(f.tables.auditorias[0].monto, 1000);
    await f.run('/webhook', {}, { 'data.id': '123' });
    assert.equal(f.tables.auditorias.length, 1);
    assert.equal(f.tables.solicitudes_pago[0].pagada_en, paid.pagada_en);
    const state = await f.run('/estado/:id_solicitud_pago', {}, {}, 'get');
    assert.equal(state.body.estado, 'pagado');
    assert.equal(state.body.pagado, true);
    assert.equal(f.get.mock.callCount(), 2);
  });

  it('guarda pago pendiente sin marcar pagado ni crear auditoría', async t => {
    const f = fixture(t, { status: 'pending' });
    await f.run('/webhook', { data: { id: 123 } });
    assert.equal(f.tables.solicitudes_pago[0].id_estado, 1);
    assert.equal(f.tables.solicitudes_pago[0].mercadopago_status, 'pending');
    assert.equal(f.tables.auditorias.length, 0);
  });

  for (const [name, overrides] of [
    ['moneda incorrecta', { currency_id: 'USD' }],
    ['monto incorrecto', { transaction_amount: 999 }],
    ['solicitud inexistente', { external_reference: '999' }]
  ]) it(`no persiste un pago con ${name}`, async t => {
    const f = fixture(t, overrides);
    assert.equal((await f.run('/webhook', { data: { id: 123 } })).statusCode, 200);
    assert.equal(f.save.mock.callCount(), 0);
    assert.equal(f.tables.solicitudes_pago[0].id_estado, 1);
    assert.equal(f.tables.auditorias.length, 0);
  });

  it('webhook sin ID y fallo del SDK no modifican datos', async t => {
    const f = fixture(t);
    await f.run('/webhook', { type: 'payment' });
    assert.equal(f.get.mock.callCount(), 0);
    f.get.mock.mockImplementation(async () => { throw new Error('SDK simulado no disponible'); });
    assert.equal((await f.run('/webhook', { data: { id: 123 } })).statusCode, 200);
    assert.equal(f.save.mock.callCount(), 0);
  });

  it('crea preferencia con monto, moneda y referencia internos', async t => {
    const f = fixture(t);
    const res = await f.run('/preferencia', { id_solicitud: 7 });
    assert.equal(res.statusCode, 200);
    const { body } = f.create.mock.calls[0].arguments[0];
    assert.deepEqual(body.items, [{ title: 'AuditCloud - Auditoría ambiental', quantity: 1, unit_price: 1000, currency_id: 'MXN' }]);
    assert.equal(body.external_reference, '7');
    assert.equal(body.metadata.id_solicitud_pago, 7);
    assert.equal(f.tables.solicitudes_pago[0].id_preferencia, 'pref-test');
    assert.equal(res.body.preference_id, 'pref-test');
  });
});
