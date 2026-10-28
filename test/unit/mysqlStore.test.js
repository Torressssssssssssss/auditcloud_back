const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mockPersistence, assertCommitted, assertRolledBack } = require('./helpers/mysql');

const columns = [
  { Field: 'id_usuario', Type: 'int' },
  { Field: 'nombre', Type: 'varchar(100)' },
  { Field: 'activo', Type: 'tinyint' },
  { Field: 'creado_en', Type: 'datetime' }
];
const original = { id_usuario: 7, nombre: 'Original', activo: 1, creado_en: '2026-01-02 03:04:05' };

// Se valida cada sentencia y sus parámetros; cualquier SQL adicional falla.
function repository(t, steps) {
  const pending = [...steps];
  const fixture = mockPersistence(t, {
    execute(sql, params) {
      const step = pending.shift();
      assert.ok(step, `Consulta no esperada: ${sql}`);
      assert.match(sql, step.sql);
      if (step.params) assert.deepEqual(params, step.params);
      if (step.error) throw step.error;
      return structuredClone(step.rows);
    }
  });
  t.after(() => assert.equal(pending.length, 0, 'Deben ejecutarse todas las consultas previstas'));
  return fixture;
}

const selectUsers = (rows = [original]) => ({ sql: /^SELECT \* FROM `usuarios`$/, rows });
const userSchema = () => ({ sql: /^SHOW COLUMNS FROM `usuarios`$/, rows: columns });

describe('mysqlStore: proyecciones y snapshots', { concurrency: false }, () => {
  it('proyecta fechas, booleanos y montos sin modificar las filas del driver', async t => {
    const date = new Date('2026-01-02T03:04:05.000Z');
    const source = [{ id_solicitud: 1, fecha: date, activo: 1, leida: 0,
      monto: '12.50', mercadopago_transaction_amount: '10.25',
      mercadopago_payment_id: 'payment-7', id_preferencia: 'preference-8' }];
    const { db, store, connection } = mockPersistence(t, { execute: () => source });
    await db.withTransaction(async () => {
      const rows = await store.listRows('solicitudes_pago');
      assert.deepEqual(rows, [{ id_solicitud: 1, fecha: date.toISOString(), activo: true, leida: false,
        monto: 12.5, mercadopago_transaction_amount: 10.25,
        mercadopago_payment_id: 'payment-7', id_preferencia: 'preference-8',
        id_pago_mercadopago: 'payment-7', preference_id: 'preference-8' }]);
      const snapshot = db.transactionContext.getStore().snapshots.get('solicitudes_pago');
      assert.deepEqual(snapshot, rows);
      rows[0].monto = 99;
      assert.equal(snapshot[0].monto, 12.5);
    }, { write: false });
    assert.strictEqual(source[0].fecha, date);
    assert.equal(source[0].monto, '12.50');
    assertCommitted(connection);
  });

  it('proyecta url_archivo como url en evidencias y conserva montos nulos', async t => {
    const { db, store } = repository(t, [{ sql: /^SELECT \* FROM `evidencias`$/,
      rows: [{ id_evidencia: 1, url_archivo: '/archivo.pdf', monto: null }] }]);
    await db.withTransaction(async () => {
      assert.deepEqual(await store.listRows('evidencias'), [
        { id_evidencia: 1, url_archivo: '/archivo.pdf', url: '/archivo.pdf', monto: null }
      ]);
    }, { write: false });
  });

  it('rechaza persistir fuera de una transacción', async t => {
    const { store, createPool } = mockPersistence(t);
    await assert.rejects(store.saveRows('usuarios', []), /Repository requires a transaction/);
    assert.equal(createPool.mock.callCount(), 0);
  });

  it('rechaza entidades desconocidas sin ejecutar SQL', async t => {
    const { db, store, connection } = mockPersistence(t);
    await assert.rejects(db.withTransaction(() => store.listRows('usuarios; DROP TABLE usuarios')), /Unknown SQL entity/);
    assert.equal(connection.execute.mock.callCount(), 0);
    assertRolledBack(connection);
  });

  it('impide escrituras en una transacción de solo lectura', async t => {
    const { db, store, connection } = mockPersistence(t);
    await assert.rejects(db.withTransaction(() => store.saveRows('usuarios', []), { write: false }),
      /Read-only operation attempted a write/);
    assert.equal(connection.execute.mock.callCount(), 0);
    assertRolledBack(connection);
  });

  it('exige un snapshot antes de persistir', async t => {
    const { db, store, connection } = mockPersistence(t);
    await assert.rejects(db.withTransaction(() => store.saveRows('usuarios', [])), /Cannot persist without a snapshot/);
    assert.equal(connection.execute.mock.callCount(), 0);
    assertRolledBack(connection);
  });
});

describe('mysqlStore: persistencia diferencial y conflictos', { concurrency: false }, () => {
  it('no escribe filas sin cambios y reutiliza el esquema en memoria', async t => {
    const { db, store, connection } = repository(t, [selectUsers(), userSchema()]);
    await db.withTransaction(async () => {
      const rows = await store.listRows('usuarios');
      await store.saveRows('usuarios', rows);
      await store.saveRows('usuarios', rows);
    });
    assert.equal(connection.execute.mock.callCount(), 2);
    assertCommitted(connection);
  });

  it('actualiza solo columnas cambiadas con una condición optimista y renueva el snapshot', async t => {
    const { db, store, connection } = repository(t, [selectUsers(), userSchema(), {
      sql: /^UPDATE `usuarios` SET `nombre`=\? WHERE `id_usuario`=\? AND `nombre` <=> \?$/,
      params: ['Nuevo', 7, 'Original'], rows: { affectedRows: 1 }
    }]);
    await db.withTransaction(async () => {
      const rows = await store.listRows('usuarios');
      rows[0].nombre = 'Nuevo';
      await store.saveRows('usuarios', rows);
      const snapshot = db.transactionContext.getStore().snapshots.get('usuarios');
      assert.equal(snapshot[0].nombre, 'Nuevo');
      assert.notStrictEqual(snapshot[0], rows[0]);
      await store.saveRows('usuarios', rows);
    });
    assertCommitted(connection);
  });

  it('inserta filas nuevas convirtiendo booleanos y fechas a valores SQL', async t => {
    const { db, store, connection } = repository(t, [selectUsers([]), userSchema(), {
      sql: /^INSERT INTO `usuarios` \(`id_usuario`,`nombre`,`activo`,`creado_en`\) VALUES \(\?,\?,\?,\?\)$/,
      params: [8, 'Nuevo', 1, '2026-02-03 04:05:06'], rows: { affectedRows: 1 }
    }]);
    await db.withTransaction(async () => {
      const rows = await store.listRows('usuarios');
      rows.push({ id_usuario: 8, nombre: 'Nuevo', activo: true, creado_en: '2026-02-03T04:05:06.000Z' });
      await store.saveRows('usuarios', rows);
    });
    assertCommitted(connection);
  });

  it('elimina solo la fila omitida y compara todas sus columnas originales', async t => {
    const { db, store, connection } = repository(t, [selectUsers(), userSchema(), {
      sql: /^DELETE FROM `usuarios` WHERE `id_usuario` <=> \? AND `nombre` <=> \? AND `activo` <=> \? AND `creado_en` <=> \?$/,
      params: [7, 'Original', 1, '2026-01-02 03:04:05'], rows: { affectedRows: 1 }
    }]);
    await db.withTransaction(async () => {
      await store.listRows('usuarios');
      await store.saveRows('usuarios', []);
    });
    assertCommitted(connection);
  });

  for (const operation of ['update', 'delete']) {
    it(`detecta ${operation} concurrente, devuelve conflicto 409 y revierte`, async t => {
      const { db, store, connection } = repository(t, [selectUsers(), userSchema(), {
        sql: operation === 'update' ? /^UPDATE `usuarios`/ : /^DELETE FROM `usuarios`/,
        rows: { affectedRows: 0 }
      }]);
      await assert.rejects(db.withTransaction(async () => {
        const rows = await store.listRows('usuarios');
        if (operation === 'update') rows[0].nombre = 'Cambio';
        await store.saveRows('usuarios', operation === 'update' ? rows : []);
      }), { statusCode: 409, message: `Concurrent ${operation}` });
      assertRolledBack(connection);
      assert.equal(connection.commit.mock.callCount(), 0);
    });
  }

  for (const code of ['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK']) {
    it(`revierte la persistencia y propaga el error MySQL ${code}`, async t => {
      const error = Object.assign(new Error(code), { code });
      const { db, store, connection } = repository(t, [selectUsers([]), userSchema(), {
        sql: /^INSERT INTO `usuarios`/, error
      }]);
      await assert.rejects(db.withTransaction(async () => {
        await store.listRows('usuarios');
        await store.saveRows('usuarios', [{ id_usuario: 7, nombre: 'Nuevo' }]);
      }), actual => actual === error);
      assertRolledBack(connection);
      assert.equal(connection.commit.mock.callCount(), 0);
    });
  }

  for (const ids of [[7, 7], [1.5], ['7']]) {
    it(`rechaza claves primarias inválidas ${JSON.stringify(ids)} antes de escribir`, async t => {
      const { db, store, connection } = repository(t, [selectUsers([]), userSchema()]);
      await assert.rejects(db.withTransaction(async () => {
        await store.listRows('usuarios');
        await store.saveRows('usuarios', ids.map(id_usuario => ({ id_usuario })));
      }), /Invalid primary keys/);
      assert.equal(connection.execute.mock.callCount(), 2);
      assertRolledBack(connection);
    });
  }

  it('rechaza fechas inválidas y revierte sin ejecutar una inserción', async t => {
    const { db, store, connection } = repository(t, [selectUsers([]), userSchema()]);
    await assert.rejects(db.withTransaction(async () => {
      await store.listRows('usuarios');
      await store.saveRows('usuarios', [{ id_usuario: 8, creado_en: 'fecha inválida' }]);
    }), /Invalid datetime/);
    assertRolledBack(connection);
  });
});

describe('mysqlStore: asignación transaccional de IDs', { concurrency: false }, () => {
  for (const [last, maximum, expected] of [[10, 7, 11], [4, 20, 21]]) {
    it(`reserva ${expected} usando el máximo entre secuencia ${last} y tabla ${maximum}`, async t => {
      const { db, store, connection } = repository(t, [
        { sql: /^INSERT IGNORE INTO app_sequences/, params: ['usuarios'], rows: { affectedRows: 0 } },
        { sql: /^SELECT last_id FROM app_sequences WHERE entity=\? FOR UPDATE$/,
          params: ['usuarios'], rows: [{ last_id: String(last) }] },
        { sql: /^SELECT COALESCE\(MAX\(`id_usuario`\),0\) AS maximum FROM `usuarios`$/,
          rows: [{ maximum: String(maximum) }] },
        { sql: /^UPDATE app_sequences SET last_id=\? WHERE entity=\?$/,
          params: [expected, 'usuarios'], rows: { affectedRows: 1 } }
      ]);
      assert.equal(await db.withTransaction(() => store.nextId('usuarios')), expected);
      assertCommitted(connection);
    });
  }

  it('rechaza reservar IDs en una transacción de lectura o con un campo incorrecto', async t => {
    const { db, store, connection } = mockPersistence(t);
    await assert.rejects(db.withTransaction(() => store.nextId('usuarios'), { write: false }), /Invalid ID allocation/);
    await assert.rejects(db.withTransaction(() => store.nextId('usuarios', 'otro_campo')), /Invalid ID allocation/);
    assert.equal(connection.execute.mock.callCount(), 0);
    assert.equal(connection.rollback.mock.callCount(), 2);
    assert.equal(connection.release.mock.callCount(), 2);
  });
});
