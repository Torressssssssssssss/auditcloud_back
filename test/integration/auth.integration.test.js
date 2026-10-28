const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { IncomingMessage, ServerResponse } = require('node:http');
const { Duplex } = require('node:stream');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { mockPersistence } = require('../unit/helpers/mysql');

const SECRET = 'integration_auth_only_no_real_credentials';
const PASSWORD = 'integration_password';
const DENIED = 'No tienes permisos para ver las conversaciones de otro cliente';
const user = {
  id_usuario: 1, id_empresa: 10, id_rol: 3, nombre: 'Cliente A',
  correo: 'a@example.test', password_hash: PASSWORD, activo: 1, rol: 'CLIENTE'
};
const conversations = [
  { id_conversacion: 11, id_cliente: 1, id_empresa_auditora: 100, activo: 1 },
  { id_conversacion: 22, id_cliente: 2, id_empresa_auditora: 100, activo: 1 }
];

function fixture(t) {
  const environment = {
    NODE_ENV: 'test', JWT_SECRET: SECRET, GOOGLE_AUTH_ENABLED: 'false',
    GOOGLE_CLIENT_ID: '', ELASTICSEARCH_ENABLED: 'false', EMAIL_USER: '', EMAIL_PASS: '',
    MERCADOPAGO_ACCESS_TOKEN: '', PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '',
    FIREBASE_SERVICE_ACCOUNT_KEY: '{}', FIREBASE_SERVICE_ACCOUNT_PATH: '',
    FIREBASE_STORAGE_BUCKET: ''
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.mock.method(require('dotenv'), 'config', () => ({ parsed: {} }));

  // Recargamos solo módulos de aplicación para que capturen el driver simulado.
  const root = path.resolve(__dirname, '../..');
  const isApplication = filename => filename === path.join(root, 'app.js') ||
    ['routes', 'utils', 'services'].some(dir => filename.startsWith(path.join(root, dir) + path.sep));
  const cached = Object.entries(require.cache).filter(([filename]) => isApplication(filename));
  for (const [filename] of cached) delete require.cache[filename];
  t.after(() => {
    for (const filename of Object.keys(require.cache)) {
      if (isApplication(filename)) delete require.cache[filename];
    }
    for (const [filename, module] of cached) require.cache[filename] = module;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // Sustituye createPool/createConnection ANTES de importar app.js.
  // db.js, sqlRouter, el login y la verificación JWT siguen siendo reales.
  const persistence = mockPersistence(t, {
    execute(sql, params) {
      if (sql.includes('INNER JOIN roles') && sql.includes('WHERE u.correo = ?')) {
        return params[0] === user.correo ? [{ ...user }] : [];
      }
      const match = /^SELECT \* FROM `(\w+)`$/.exec(sql);
      if (match) {
        const tables = {
          conversaciones: conversations,
          usuarios: [user], empresas: [{ id_empresa: 100, nombre: 'Auditora simulada' }],
          mensajes: [], auditorias: [], auditoria_participantes: []
        };
        assert.ok(Object.hasOwn(tables, match[1]), `Tabla inesperada: ${match[1]}`);
        return structuredClone(tables[match[1]]);
      }
      throw new Error(`SQL no previsto por la integración: ${sql}`);
    }
  });
  const app = require('../../app');
  return { ...persistence, request: (method, url, options) => request(app, method, url, options) };
}

// HTTP en memoria: sin listen/connect, manteniendo IncomingMessage,
// ServerResponse y todo el pipeline real de Express (incluido express.json).
async function request(app, method, url, { token, body } = {}) {
  const chunks = [];
  const socket = new Duplex({
    read() {},
    write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); }
  });
  const req = new IncomingMessage(socket);
  req.httpVersion = '1.1';
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;
  req.method = method;
  req.url = url;
  req.headers = { host: 'integration.test', connection: 'close' };
  if (token) req.headers.authorization = `Bearer ${token}`;
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  if (data) {
    req.headers['content-type'] = 'application/json';
    req.headers['content-length'] = String(data.length);
  }
  const res = new ServerResponse(req);
  res.assignSocket(socket);
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout HTTP: ${method} ${url}`)), 3000);
      res.once('error', reject);
      req.once('error', reject);
      socket.once('error', reject);
      res.once('finish', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const payload = raw.slice(raw.indexOf('\r\n\r\n') + 4);
          resolve({ status: res.statusCode, body: JSON.parse(payload) });
        } catch (error) { reject(error); }
      });
      if (data) req.push(data);
      req.push(null);
      req.complete = true;
      app.handle(req, res, reject);
    });
  } finally {
    clearTimeout(timer);
    req.destroy();
    res.destroy();
    socket.destroy();
  }
}

async function login(f) {
  const result = await f.request('POST', '/api/auth/login', {
    body: { correo: user.correo, password: PASSWORD }
  });
  assert.equal(result.status, 200);
  assert.equal(jwt.verify(result.body.token, SECRET).id_usuario, 1);
  return result.body.token;
}

describe('Integración Express + JWT con MySQL simulado', { concurrency: false }, () => {
  it('caso 1: login genera un JWT válido para el usuario simulado 1', async t => {
    const f = fixture(t);
    const token = await login(f);
    const claims = jwt.verify(token, SECRET);
    assert.equal(claims.id_rol, 3);
    assert.equal(claims.id_empresa, 10);
    assert.ok(claims.exp > claims.iat);
    assert.equal(Object.hasOwn(claims, 'password_hash'), false);
    assert.equal(f.connection.commit.mock.callCount(), 1);
    assert.equal(f.connection.release.mock.callCount(), 1);
  });

  it('caso 2: rechaza login con contraseña incorrecta', async t => {
    const f = fixture(t);
    const result = await f.request('POST', '/api/auth/login', {
      body: { correo: user.correo, password: 'incorrecta' }
    });
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { message: 'Credenciales inválidas' });
  });

  it('caso 3: rechaza conversaciones sin JWT', async t => {
    const f = fixture(t);
    const result = await f.request('GET', '/api/cliente/conversaciones/2');
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { message: 'Token no proporcionado' });
    assert.equal(f.pool.getConnection.mock.callCount(), 0);
  });

  it('caso 4: rechaza conversaciones con JWT inválido', async t => {
    const f = fixture(t);
    const result = await f.request('GET', '/api/cliente/conversaciones/2', { token: 'invalido' });
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { message: 'Token inválido o expirado' });
    assert.equal(f.pool.getConnection.mock.callCount(), 0);
  });

  it('caso 5: un cliente autenticado no puede usar rutas de supervisor', async t => {
    const f = fixture(t);
    const token = await login(f);
    const result = await f.request('GET', '/api/supervisor/conversaciones', { token });
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { message: 'No tienes permiso para realizar esta acción' });
  });

  it('caso 6: permite listar conversaciones propias con datos simulados', async t => {
    const f = fixture(t);
    const token = await login(f);
    const result = await f.request('GET', '/api/cliente/conversaciones/1', { token });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.map(row => row.id_conversacion), [11]);
    assert.equal(result.body[0].empresa.nombre, 'Auditora simulada');
  });

  it('caso 7 (IDOR): usuario 1 no puede listar conversaciones del usuario 2', async t => {
    const f = fixture(t);
    const token = await login(f);
    const queries = f.connection.execute.mock.callCount();
    const rollbacks = f.connection.rollback.mock.callCount();
    const releases = f.connection.release.mock.callCount();
    const result = await f.request('GET', '/api/cliente/conversaciones/2', { token });
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { message: DENIED });
    assert.equal(f.connection.execute.mock.callCount(), queries, 'IDOR debe rechazarse antes de consultar datos');
    assert.equal(f.connection.rollback.mock.callCount(), rollbacks + 1);
    assert.equal(f.connection.release.mock.callCount(), releases + 1);
    t.diagnostic('IDOR: JWT usuario=1; GET /api/cliente/conversaciones/2 → 403; mensaje correcto; sin consultas de datos');
  });
});
