const assert = require('node:assert/strict');

// No se invoca ninguna fábrica real del driver. Cada caso carga módulos nuevos
// para aislar el pool, AsyncLocalStorage y la caché de esquemas del repositorio.
function mockPersistence(t, options = {}) {
  const mysql = require('mysql2/promise');
  const paths = ['db', 'mysqlStore', 'sqlRouter'].map(name => require.resolve(`../../../utils/${name}`));
  const cached = paths.map(path => require.cache[path]);
  const env = {
    DB_HOST: 'mysql.invalid', DB_PORT: '3306', DB_USER: 'unit_test',
    DB_PASSWORD: 'unit_test_only', DB_NAME: 'auditcloud_db', DB_CONNECTION_LIMIT: '2'
  };
  const previousEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  for (const path of paths) delete require.cache[path];
  t.after(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    paths.forEach((path, index) => {
      delete require.cache[path];
      if (cached[index]) require.cache[path] = cached[index];
    });
  });

  const events = [];
  const unexpected = sql => { throw new Error(`SQL no previsto por la prueba: ${sql}`); };
  function makeConnection(label = 'connection') {
    return {
      execute: t.mock.fn(async (sql, params) => {
        events.push(`${label}.execute`);
        return [(options.execute || unexpected)(sql, params, label), []];
      }),
      query: t.mock.fn(async sql => {
        if (sql.includes('GET_LOCK')) {
          events.push(`${label}.lock`);
          return [[{ acquired: options.acquired ?? 1 }], []];
        }
        if (sql.includes('RELEASE_LOCK')) {
          events.push(`${label}.unlock`);
          return [[{ released: 1 }], []];
        }
        return unexpected(sql);
      }),
      beginTransaction: t.mock.fn(async () => {
        events.push(`${label}.begin`);
        if (options.beginError) throw options.beginError;
      }),
      commit: t.mock.fn(async () => {
        events.push(`${label}.commit`);
        if (options.commitError) throw options.commitError;
      }),
      rollback: t.mock.fn(async () => { events.push(`${label}.rollback`); }),
      release: t.mock.fn(() => { events.push(`${label}.release`); })
    };
  }
  const connection = makeConnection();
  const pool = {
    execute: t.mock.fn(async (sql, params) => {
      events.push('pool.execute');
      return [(options.execute || unexpected)(sql, params, 'pool'), []];
    }),
    query: t.mock.fn(unexpected),
    getConnection: t.mock.fn(async () => {
      events.push('pool.getConnection');
      if (options.connectionError) throw options.connectionError;
      return options.getConnection ? options.getConnection() : connection;
    })
  };
  const createPool = t.mock.method(mysql, 'createPool', () => pool);
  t.mock.method(mysql, 'createConnection', () => {
    throw new Error('Una prueba intentó crear una conexión fuera del pool simulado');
  });
  const db = require(paths[0]);
  return {
    db, store: require(paths[1]), transactionalRouter: require(paths[2]).transactionalRouter,
    pool, connection, createPool, events, options, makeConnection
  };
}

function assertCommitted(connection) {
  assert.equal(connection.commit.mock.callCount(), 1);
  assert.equal(connection.rollback.mock.callCount(), 0);
  assert.equal(connection.release.mock.callCount(), 1);
}

function assertRolledBack(connection) {
  assert.equal(connection.rollback.mock.callCount(), 1);
  assert.equal(connection.release.mock.callCount(), 1);
}

module.exports = { mockPersistence, assertCommitted, assertRolledBack };
