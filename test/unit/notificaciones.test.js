const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isolateExternals } = require('./helpers/externalIsolation');
const { mockPersistence, assertCommitted, assertRolledBack } = require('./helpers/mysql');

async function fixture(t, options = {}) {
  const { replace } = isolateExternals(t, {
    EMAIL_USER: options.disabled ? undefined : 'alertas@example.test',
    EMAIL_PASS: options.disabled ? undefined : 'password-solo-test'
  });
  const verify = t.mock.fn(async () => { if (options.verifyError) throw options.verifyError; });
  const sendMail = t.mock.fn(async () => {
    if (options.sendError) throw options.sendError;
    return { messageId: 'correo-simulado' };
  });
  const createTransport = t.mock.fn(() => ({ verify, sendMail }));
  replace('nodemailer', { createTransport });
  const service = require('../../utils/email.service');
  await new Promise(resolve => setImmediate(resolve));
  return { service, verify, sendMail, createTransport };
}

function persistence(t, options = {}) {
  let inserted;
  const columns = ['id_notificacion', 'id_cliente', 'id_auditoria', 'tipo', 'titulo', 'mensaje', 'fecha', 'leida'];
  const p = mockPersistence(t, { ...options, execute(sql, params) {
    if (sql === 'SELECT * FROM `notificaciones`') return [];
    if (sql.startsWith('INSERT IGNORE INTO app_sequences')) return { affectedRows: 1 };
    if (sql.startsWith('SELECT last_id')) return [{ last_id: 0 }];
    if (sql.startsWith('SELECT COALESCE(MAX')) return [{ maximum: 0 }];
    if (sql.startsWith('UPDATE app_sequences')) return { affectedRows: 1 };
    if (sql === 'SHOW COLUMNS FROM `notificaciones`') return columns.map(Field => ({ Field, Type: 'varchar(255)' }));
    if (sql.startsWith('INSERT INTO `notificaciones`')) {
      inserted = Object.fromEntries(columns.map((key, index) => [key, params[index]]));
      return { affectedRows: 1 };
    }
    if (sql === 'SELECT nombre,correo FROM usuarios WHERE id_usuario=?') {
      assert.deepEqual(params, [9]);
      return [{ nombre: 'Ana', correo: 'ana@example.test' }];
    }
    throw new Error(`SQL inesperado: ${sql}`);
  } });
  return { ...p, inserted: () => inserted };
}
const event = { id_cliente: 9, id_auditoria: 3, tipo: 'evidencia', titulo: 'Nueva evidencia', mensaje: 'Se agregó un informe ambiental.' };

describe('Notificaciones: Nodemailer y MySQL aislados', { concurrency: false }, () => {
  it('persiste el evento y envía destinatario/asunto correctos después del commit', async t => {
    const f = await fixture(t);
    const p = persistence(t);
    await p.db.withTransaction(async () => {
      const notification = await p.store.crearNotificacion(event);
      assert.equal(notification.id_cliente, 9);
      assert.equal(notification.leida, false);
      assert.equal(f.sendMail.mock.callCount(), 0);
      assert.equal(p.connection.commit.mock.callCount(), 0);
    });
    await new Promise(resolve => setImmediate(resolve));
    assertCommitted(p.connection);
    assert.equal(p.inserted().titulo, event.titulo);
    assert.equal(f.verify.mock.callCount(), 1);
    assert.equal(f.sendMail.mock.callCount(), 1);
    const [mail] = f.sendMail.mock.calls[0].arguments;
    assert.equal(mail.to, 'ana@example.test');
    assert.equal(mail.from, '"AuditCloud Alertas" <alertas@example.test>');
    assert.equal(mail.subject, '🔔 Nueva evidencia - AuditCloud');
    assert.ok(mail.html.includes('Ana'));
    assert.ok(mail.html.includes(event.mensaje));
  });
  it('no envía correo si falla el commit', async t => {
    const f = await fixture(t);
    const error = new Error('commit simulado fallido');
    const p = persistence(t, { commitError: error });
    await assert.rejects(p.db.withTransaction(() => p.store.crearNotificacion(event)), error);
    await new Promise(resolve => setImmediate(resolve));
    assertRolledBack(p.connection);
    assert.equal(f.sendMail.mock.callCount(), 0);
  });
  it('devuelve false si falla sendMail sin propagar el error', async t => {
    const f = await fixture(t, { sendError: new Error('SMTP simulado fallido') });
    assert.equal(await f.service.enviarAlertaNotificacion('ana@example.test', 'Ana', event.titulo, event.mensaje), false);
    assert.equal(f.sendMail.mock.callCount(), 1);
  });
  for (const [name, options] of [
    ['sin credenciales', { disabled: true }],
    ['con verificación SMTP fallida', { verifyError: new Error('verify simulado fallido') }]
  ]) it(`no envía ${name}`, async t => {
    const f = await fixture(t, options);
    assert.equal(await f.service.enviarAlertaNotificacion('ana@example.test', 'Ana', event.titulo, event.mensaje), false);
    assert.equal(f.sendMail.mock.callCount(), 0);
    assert.equal(f.createTransport.mock.callCount(), options.disabled ? 0 : 1);
  });
});
