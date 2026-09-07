// Single MySQL pool and transaction context for AuditCloud MVP.
const mysql = require('mysql2/promise');
const { AsyncLocalStorage } = require('node:async_hooks');
const transactionContext = new AsyncLocalStorage();

let pool = null;

function buildNotConfiguredError(missing) {
  const err = new Error(
    'MySQL no configurado: define DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME en variables de entorno.'
  );
  err.code = 'DB_NOT_CONFIGURED';
  err.missing = missing;
  return err;
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  return String(value);
}

function getPool() {
  if (pool) return pool;

  const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missing = required.filter((key) => !getRequiredEnv(key));
  if (missing.length > 0) {
    throw buildNotConfiguredError(missing);
  }

  const host = getRequiredEnv('DB_HOST');
  const port = Number(getRequiredEnv('DB_PORT'));
  const user = getRequiredEnv('DB_USER');
  const password = getRequiredEnv('DB_PASSWORD');
  const database = getRequiredEnv('DB_NAME');
  if (database !== 'auditcloud_db') throw new Error('AuditCloud requires auditcloud_db');

  if (!Number.isFinite(port)) {
    const err = new Error('DB_PORT inválido; debe ser un número.');
    err.code = 'DB_BAD_PORT';
    throw err;
  }

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
    queueLimit: 0,
    // Keep timezone consistent with SQL seed script (UTC)
    timezone: 'Z'
  });

  return pool;
}

async function query(sql, params = []) {
  const db = transactionContext.getStore()?.connection || getPool();
  try {
    const [rows] = await db.execute(sql, params);
    return rows;
  } catch (error) {
    const context = transactionContext.getStore();
    if (context) context.failed = error;
    throw error;
  }
}

async function withTransaction(operation, { write = true } = {}) {
  if (transactionContext.getStore()) return operation();
  const connection = await getPool().getConnection();
  const context = { connection, snapshots: new Map(), afterCommit: [], write };
  let locked = false;
  try {
    // Serialize MVP mutations across workers while preserving the existing response models.
    // SQL row diffs never replace a table; external changes are checked optimistically.
    if (write) {
      const [rows] = await connection.query("SELECT GET_LOCK('auditcloud_db.mvp.write', 15) AS acquired");
      if (rows[0].acquired !== 1) { const e = new Error('Busy'); e.statusCode = 503; throw e; }
      locked = true;
    }
    await connection.beginTransaction();
    const result = await transactionContext.run(context, operation);
    if (context.failed) throw context.failed;
    await connection.commit();
    for (const callback of context.afterCommit) {
      Promise.resolve().then(callback).catch(error => console.error('[After commit]', error.code || error.name));
    }
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK('auditcloud_db.mvp.write')");
    connection.release();
  }
}
function afterCommit(callback) {
  const context = transactionContext.getStore();
  if (context) context.afterCommit.push(callback);
  else Promise.resolve().then(callback).catch(error => console.error('[After commit]', error.code || error.name));
}

module.exports = {
  getPool,
  query,
  withTransaction,
  transactionContext,
  afterCommit
};
