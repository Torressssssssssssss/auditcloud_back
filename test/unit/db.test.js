const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mockPersistence, assertCommitted, assertRolledBack } = require('./helpers/mysql');

describe('db: pool y consultas', { concurrency: false }, () => {
  it('crea un único pool bajo demanda con la configuración esperada', t => {
    const { db, pool, createPool } = mockPersistence(t);
    assert.equal(createPool.mock.callCount(), 0);
    assert.strictEqual(db.getPool(), pool);
    assert.strictEqual(db.getPool(), pool);
    assert.equal(createPool.mock.callCount(), 1);
    assert.deepEqual(createPool.mock.calls[0].arguments, [{
      host: 'mysql.invalid', port: 3306, user: 'unit_test', password: 'unit_test_only',
      database: 'auditcloud_db', waitForConnections: true,
      connectionLimit: 2, queueLimit: 0, timezone: 'Z'
    }]);
  });

  it('rechaza configuración ausente antes de crear el pool', t => {
    const { db, createPool } = mockPersistence(t);
    delete process.env.DB_HOST;
    assert.throws(() => db.getPool(), error => {
      assert.equal(error.code, 'DB_NOT_CONFIGURED');
      assert.deepEqual(error.missing, ['DB_HOST']);
      return true;
    });
    assert.equal(createPool.mock.callCount(), 0);
  });

  it('rechaza un puerto inválido sin crear conexiones', t => {
    const { db, createPool } = mockPersistence(t);
    process.env.DB_PORT = 'no-es-un-puerto';
    assert.throws(() => db.getPool(), { code: 'DB_BAD_PORT' });
    assert.equal(createPool.mock.callCount(), 0);
  });

  it('ejecuta consultas parametrizadas y devuelve solo las filas', async t => {
    const rows = [{ id_usuario: 7 }];
    const { db, pool } = mockPersistence(t, { execute: () => rows });
    assert.strictEqual(await db.query('SELECT * FROM usuarios WHERE id_usuario=?', [7]), rows);
    assert.deepEqual(pool.execute.mock.calls[0].arguments,
      ['SELECT * FROM usuarios WHERE id_usuario=?', [7]]);
    await db.query('SELECT 1');
    assert.deepEqual(pool.execute.mock.calls[1].arguments, ['SELECT 1', []]);
    assert.equal(pool.getConnection.mock.callCount(), 0);
  });

  it('propaga el error original de una consulta fuera de transacción', async t => {
    const error = Object.assign(new Error('SQL inválido'), { code: 'ER_PARSE_ERROR' });
    const { db } = mockPersistence(t, { execute: () => { throw error; } });
    await assert.rejects(db.query('SQL inválido'), actual => actual === error);
    assert.equal(db.transactionContext.getStore(), undefined);
  });
});

describe('db: transacciones y AsyncLocalStorage', { concurrency: false }, () => {
  it('usa la conexión de la transacción y confirma antes de liberarla', async t => {
    const { db, pool, connection, events } = mockPersistence(t, { execute: () => [{ ok: 1 }] });
    const result = await db.withTransaction(async () => {
      await Promise.resolve();
      assert.strictEqual(db.transactionContext.getStore().connection, connection);
      return db.query('SELECT ?', [1]);
    });
    assert.deepEqual(result, [{ ok: 1 }]);
    assert.equal(pool.execute.mock.callCount(), 0);
    assertCommitted(connection);
    assert.deepEqual(events, ['pool.getConnection', 'connection.lock', 'connection.begin',
      'connection.execute', 'connection.commit', 'connection.unlock', 'connection.release']);
    assert.equal(db.transactionContext.getStore(), undefined);
  });

  it('reutiliza la transacción exterior al anidar operaciones', async t => {
    const { db, pool, connection } = mockPersistence(t);
    const result = await db.withTransaction(async () => {
      const outer = db.transactionContext.getStore();
      return db.withTransaction(async () => {
        assert.strictEqual(db.transactionContext.getStore(), outer);
        return 42;
      });
    });
    assert.equal(result, 42);
    assert.equal(pool.getConnection.mock.callCount(), 1);
    assert.equal(connection.beginTransaction.mock.callCount(), 1);
    assertCommitted(connection);
  });

  it('omite el bloqueo de escritura en transacciones de lectura', async t => {
    const { db, connection } = mockPersistence(t);
    await db.withTransaction(async () => {
      assert.equal(db.transactionContext.getStore().write, false);
    }, { write: false });
    assert.equal(connection.query.mock.callCount(), 0);
    assertCommitted(connection);
  });

  it('revierte y libera la conexión si falla la operación', async t => {
    const error = new Error('operación fallida');
    const { db, connection, events } = mockPersistence(t);
    await assert.rejects(db.withTransaction(async () => { throw error; }), actual => actual === error);
    assertRolledBack(connection);
    assert.equal(connection.commit.mock.callCount(), 0);
    assert.deepEqual(events.slice(-3), ['connection.rollback', 'connection.unlock', 'connection.release']);
    assert.equal(db.transactionContext.getStore(), undefined);
  });

  for (const code of ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_DUP_ENTRY']) {
    it(`propaga ${code}, hace rollback y libera la conexión incluso si el handler captura el error`, async t => {
      const error = Object.assign(new Error(code), { code });
      const { db, connection } = mockPersistence(t, { execute: () => { throw error; } });
      await assert.rejects(db.withTransaction(async () => {
        await assert.rejects(db.query('UPDATE usuarios SET nombre=?', ['Nuevo']), actual => actual === error);
        return 'el handler intentó continuar';
      }), actual => actual === error);
      assertRolledBack(connection);
      assert.equal(connection.commit.mock.callCount(), 0);
    });
  }

  for (const phase of ['begin', 'commit']) {
    it(`hace rollback y libera la conexión si falla ${phase}`, async t => {
      const error = new Error(`${phase} falló`);
      const { db, connection } = mockPersistence(t, { [`${phase}Error`]: error });
      await assert.rejects(db.withTransaction(async () => 1), actual => actual === error);
      assertRolledBack(connection);
      assert.equal(connection.commit.mock.callCount(), phase === 'commit' ? 1 : 0);
    });
  }

  it('responde con Busy 503 cuando no consigue el bloqueo y libera la conexión', async t => {
    const { db, connection, events } = mockPersistence(t, { acquired: 0 });
    const operation = t.mock.fn();
    await assert.rejects(db.withTransaction(operation), { message: 'Busy', statusCode: 503 });
    assert.equal(operation.mock.callCount(), 0);
    assert.equal(connection.beginTransaction.mock.callCount(), 0);
    assertRolledBack(connection);
    assert.deepEqual(events, ['pool.getConnection', 'connection.lock', 'connection.rollback', 'connection.release']);
  });

  it('propaga fallos al adquirir conexión sin intentar operar sobre una conexión inexistente', async t => {
    const error = Object.assign(new Error('pool agotado'), { code: 'POOL_CLOSED' });
    const { db, connection } = mockPersistence(t, { connectionError: error });
    const operation = t.mock.fn();
    await assert.rejects(db.withTransaction(operation), actual => actual === error);
    assert.equal(operation.mock.callCount(), 0);
    assert.equal(connection.rollback.mock.callCount(), 0);
    assert.equal(connection.release.mock.callCount(), 0);
  });

  it('aísla conexiones y snapshots entre operaciones asíncronas concurrentes', async t => {
    const { db, options, makeConnection } = mockPersistence(t);
    const connections = [makeConnection('A'), makeConnection('B')];
    let index = 0;
    options.getConnection = () => connections[index++];
    options.execute = (sql, params, label) => [{ label }];
    let ready;
    const barrier = new Promise(resolve => { ready = resolve; });
    let entered = 0;
    await Promise.all(connections.map((connection, i) => db.withTransaction(async () => {
      const context = db.transactionContext.getStore();
      context.snapshots.set('usuarios', [i]);
      if (++entered === 2) ready();
      await barrier;
      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(db.transactionContext.getStore(), context);
      assert.strictEqual(context.connection, connection);
      assert.deepEqual(context.snapshots.get('usuarios'), [i]);
      assert.deepEqual(await db.query('SELECT label'), [{ label: i === 0 ? 'A' : 'B' }]);
    }, { write: false })));
    connections.forEach(assertCommitted);
    assert.equal(db.transactionContext.getStore(), undefined);
  });

  it('ejecuta afterCommit después de confirmar y lo descarta al hacer rollback', async t => {
    const { db, events } = mockPersistence(t);
    const callback = t.mock.fn(() => { events.push('callback'); });
    await db.withTransaction(async () => {
      db.afterCommit(callback);
      assert.equal(callback.mock.callCount(), 0);
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(callback.mock.callCount(), 1);
    assert.ok(events.indexOf('callback') > events.indexOf('connection.commit'));
    await assert.rejects(db.withTransaction(async () => {
      db.afterCommit(callback);
      throw new Error('rollback');
    }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(callback.mock.callCount(), 1);
  });

  it('ejecuta afterCommit sin transacción y registra errores sin rechazos no manejados', async t => {
    const { db } = mockPersistence(t);
    const log = t.mock.method(console, 'error', () => {});
    db.afterCommit(() => { throw Object.assign(new Error('fallo callback'), { code: 'CALLBACK_ERROR' }); });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(log.mock.calls[0].arguments, ['[After commit]', 'CALLBACK_ERROR']);
  });
});
