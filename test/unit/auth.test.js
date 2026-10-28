const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const TEST_SECRET = 'clave_exclusiva_para_pruebas_unitarias';
const FALLBACK_SECRET = 'secreto_super_seguro_para_token';
const usuario = Object.freeze({
  id_usuario: 42,
  id_rol: 2,
  id_empresa: 7,
  nombre: 'Usuario de prueba',
  correo: 'prueba@example.test'
});

function loadAuth(t, secret = TEST_SECRET) {
  const modulePath = require.resolve('../../utils/auth');
  const previousModule = require.cache[modulePath];
  const previousSecret = process.env.JWT_SECRET;

  // Evita que un .env local reponga JWT_SECRET o introduzca configuración real.
  // La firma y la verificación de jsonwebtoken se ejecutan sin mocks.
  t.mock.method(require('dotenv'), 'config', () => ({ parsed: {} }));
  t.after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    delete require.cache[modulePath];
    if (previousModule) require.cache[modulePath] = previousModule;
  });

  if (secret === null) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = secret;
  delete require.cache[modulePath];
  return require(modulePath);
}

function authenticateRequest(authenticate, authorization) {
  const req = { headers: {} };
  if (authorization !== undefined) req.headers.authorization = authorization;
  const result = { req, nextCalls: 0, status: undefined, body: undefined };
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    }
  };
  authenticate(req, res, () => { result.nextCalls += 1; });
  return result;
}

function assertRejected(result, status, message) {
  assert.equal(result.status, status);
  assert.deepEqual(result.body, { message });
  assert.equal(result.nextCalls, 0);
  assert.equal(Object.hasOwn(result.req, 'user'), false);
}

// Cada caso restaura el entorno y la caché; no deben ejecutarse en paralelo.
describe('JWT: signToken y authenticate', { concurrency: false }, () => {
  it('genera un token válido con el payload esperado y vigencia de 8 horas', (t) => {
    const { signToken } = loadAuth(t);
    const token = signToken({ ...usuario, password: 'no_debe_incluirse' });
    assert.equal(typeof token, 'string');
    assert.equal(token.split('.').length, 3);
    const { iat, exp, ...payload } = jwt.verify(token, TEST_SECRET);
    assert.deepEqual(payload, usuario);
    assert.equal(Number.isInteger(iat), true);
    assert.equal(exp - iat, 8 * 60 * 60);
  });

  it('verifica un token generado y adjunta el usuario antes de llamar a next', (t) => {
    const { signToken, authenticate } = loadAuth(t);
    const token = signToken(usuario);
    const result = authenticateRequest(authenticate, `Bearer ${token}`);
    assert.deepEqual(result.req.user, jwt.verify(token, TEST_SECRET));
    assert.equal(result.nextCalls, 1);
    assert.equal(result.status, undefined);
    assert.equal(result.body, undefined);
  });

  it('acepta un token firmado independientemente con la clave configurada', (t) => {
    const { authenticate } = loadAuth(t);
    const token = jwt.sign(usuario, TEST_SECRET, { expiresIn: '1h' });
    const result = authenticateRequest(authenticate, `Bearer ${token}`);
    assert.deepEqual(result.req.user, jwt.verify(token, TEST_SECRET));
    assert.equal(result.nextCalls, 1);
    assert.equal(result.status, undefined);
    assert.equal(result.body, undefined);
  });

  it('rechaza un token cuyo payload fue manipulado sin renovar la firma', (t) => {
    const { signToken, authenticate } = loadAuth(t);
    const parts = signToken(usuario).split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    parts[1] = Buffer.from(JSON.stringify({ ...payload, id_rol: 999 })).toString('base64url');
    assertRejected(authenticateRequest(authenticate, `Bearer ${parts.join('.')}`),
      403, 'Token inválido o expirado');
  });

  it('rechaza un token firmado con otra clave', (t) => {
    const { authenticate } = loadAuth(t);
    const token = jwt.sign(usuario, 'otra_clave');
    assertRejected(authenticateRequest(authenticate, `Bearer ${token}`),
      403, 'Token inválido o expirado');
  });

  for (const token of ['invalido', 'abc.def.ghi', 'abc.def', 'a.b.c.d']) {
    it(`rechaza el token malformado ${token}`, (t) => {
      const { authenticate } = loadAuth(t);
      assertRejected(authenticateRequest(authenticate, `Bearer ${token}`),
        403, 'Token inválido o expirado');
    });
  }

  it('rechaza un token expirado', (t) => {
    const { authenticate } = loadAuth(t);
    const token = jwt.sign({ ...usuario, exp: 1 }, TEST_SECRET);
    assertRejected(authenticateRequest(authenticate, `Bearer ${token}`),
      403, 'Token inválido o expirado');
  });

  for (const [name, header] of [
    ['sin cabecera Authorization', undefined],
    ['con cabecera vacía', ''],
    ['con esquema Bearer sin token', 'Bearer'],
    ['con esquema Bearer y token vacío', 'Bearer ']
  ]) {
    it(`responde 401 ${name}`, (t) => {
      const { authenticate } = loadAuth(t);
      assertRejected(authenticateRequest(authenticate, header), 401, 'Token no proporcionado');
    });
  }

  it('firma y verifica con la clave de respaldo cuando JWT_SECRET no está definida', (t) => {
    const { signToken, authenticate } = loadAuth(t, null);
    assert.equal(process.env.JWT_SECRET, undefined);
    const token = signToken(usuario);
    const { iat, exp, ...payload } = jwt.verify(token, FALLBACK_SECRET);
    assert.deepEqual(payload, usuario);
    assert.equal(exp - iat, 8 * 60 * 60);
    const independentToken = jwt.sign(usuario, FALLBACK_SECRET, { expiresIn: '1h' });
    for (const validToken of [token, independentToken]) {
      const result = authenticateRequest(authenticate, `Bearer ${validToken}`);
      assert.deepEqual(result.req.user, jwt.verify(validToken, FALLBACK_SECRET));
      assert.equal(result.nextCalls, 1);
      assert.equal(result.status, undefined);
      assert.equal(result.body, undefined);
    }
  });

  it('prioriza JWT_SECRET y rechaza tokens firmados con la clave de respaldo', (t) => {
    const { signToken, authenticate } = loadAuth(t);
    assert.throws(() => jwt.verify(signToken(usuario), FALLBACK_SECRET),
      { name: 'JsonWebTokenError', message: 'invalid signature' });
    const token = jwt.sign(usuario, FALLBACK_SECRET);
    assertRejected(authenticateRequest(authenticate, `Bearer ${token}`),
      403, 'Token inválido o expirado');
  });
});
