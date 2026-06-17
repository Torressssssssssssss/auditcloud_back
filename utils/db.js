// MySQL access layer (lazy pool). Kept separate from JSON persistence for controlled migration.
const mysql = require('mysql2/promise');

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
  const db = getPool();
  const [rows] = await db.execute(sql, params);
  return rows;
}

async function closePool() {
  if (!pool) return;

  const currentPool = pool;
  pool = null;
  await currentPool.end();
}

module.exports = {
  getPool,
  query,
  closePool
};
