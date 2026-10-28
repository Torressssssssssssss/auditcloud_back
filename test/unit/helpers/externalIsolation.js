const assert = require('node:assert/strict');
const Module = require('node:module');

// CommonJS en Node 22: t.mock.module requiere flags experimentales. Interceptamos
// el cargador con t.mock.method antes de importar el código bajo prueba.
function isolateExternals(t, env = {}) {
  const replacements = new Map();
  const originalLoad = Module._load;
  t.mock.method(Module, '_load', function (request, parent, isMain) {
    if (replacements.has(request)) return replacements.get(request);
    return originalLoad.apply(this, arguments);
  });
  const replace = (name, value) => replacements.set(name, value);
  replace('dotenv', { config: t.mock.fn(() => ({ parsed: {} })) });

  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const paths = ['routes/mercadopago.routes', 'services/paymentPersistence',
    'utils/email.service', 'utils/firebase', 'utils/firebaseStorage', 'utils/auth']
    .map(name => require.resolve(`../../../${name}`));
  const cached = paths.map(path => require.cache[path]);
  paths.forEach(path => { delete require.cache[path]; });

  const attempts = [];
  const block = name => () => {
    attempts.push(name);
    throw new Error(`Red real prohibida en pruebas: ${name}`);
  };
  for (const name of ['node:http', 'node:https']) {
    for (const method of ['request', 'get']) t.mock.method(require(name), method, block(`${name}.${method}`));
  }
  t.mock.method(require('node:net').Socket.prototype, 'connect', block('socket.connect'));
  t.mock.method(require('node:tls'), 'connect', block('tls.connect'));
  t.mock.method(globalThis, 'fetch', block('fetch'));
  for (const method of ['log', 'warn', 'error', 'info']) t.mock.method(console, method, () => {});

  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    paths.forEach((path, index) => {
      delete require.cache[path];
      if (cached[index]) require.cache[path] = cached[index];
    });
    // Detecta también intentos de red cuyos errores fueron capturados por la app.
    assert.deepEqual(attempts, [], 'No debe intentarse ninguna conexión real');
  });
  return { replace };
}

module.exports = { isolateExternals };
