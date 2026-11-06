const { describe, it } = require('node:test');
const comprobar = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { OAuth2Client: ClienteGoogle } = require('google-auth-library');
const repositorio = require('../../utils/mysqlStore');

function prepararCaso(prueba, usuarios = [])
{
  const variables = ['GOOGLE_AUTH_ENABLED', 'GOOGLE_CLIENT_ID', 'JWT_SECRET'];
  const anteriores = variables.map(nombre => process.env[nombre]);
  const rutas = ['../../controllers/google-auth.controller', '../../utils/auth'].map(require.resolve);
  const modulos = rutas.map(ruta => require.cache[ruta]);
  process.env.GOOGLE_AUTH_ENABLED = 'true';
  process.env.GOOGLE_CLIENT_ID = 'cliente-prueba.apps.googleusercontent.com';
  process.env.JWT_SECRET = 'clave-exclusiva-de-pruebas-google';
  for(const ruta of rutas)
  {
    delete require.cache[ruta];
  }
  prueba.after(() =>
  {
    variables.forEach((nombre, indice) =>
    {
      if(anteriores[indice] === undefined)
      {
        delete process.env[nombre];
      }
      else
      {
        process.env[nombre] = anteriores[indice];
      }
    });
    rutas.forEach((ruta, indice) =>
    {
      delete require.cache[ruta];
      if(modulos[indice])
      {
        require.cache[ruta] = modulos[indice];
      }
    });
  });
  const identidad = { sub: 'google-123', email: 'cliente@gmail.com', email_verified: true, name: 'Cliente' };
  const verificar = prueba.mock.method(ClienteGoogle.prototype, 'verifyIdToken', async () =>
  {
    return { getPayload: () => identidad };
  });
  prueba.mock.method(repositorio, 'listRows', async () => usuarios);
  const guardar = prueba.mock.method(repositorio, 'saveRows', async () => 
{});
  prueba.mock.method(repositorio, 'nextId', async () => 25);
  const { iniciarSesionGoogle } = require(rutas[0]);
  async function solicitar(cuerpo = { token: 'credencial-google', rol: 1 })
  {
    const resultado = { estado: 200 };
    const respuesta = {
      status(estado)
      {
        resultado.estado = estado;
        return this;
      },
      json(datos)
      {
        resultado.datos = datos;
        return this;
      }
    };
    await iniciarSesionGoogle({ body: cuerpo }, respuesta);
    return resultado;
  }
  return { solicitar, verificar, guardar, identidad };
}

describe('Inicio de sesión con Google', { concurrency: false }, () =>
{
  it('crea clientes con rol fijo, verifica audiencia y emite JWT sin contraseña', async prueba =>
  {
    const caso = prepararCaso(prueba);
    const resultado = await caso.solicitar();
    comprobar.equal(resultado.estado, 200);
    comprobar.equal(resultado.datos.usuario.id_rol, 3);
    comprobar.equal(resultado.datos.require_company_info, true);
    comprobar.equal(Object.hasOwn(resultado.datos.usuario, 'password_hash'), false);
    const sesion = jwt.verify(resultado.datos.token, process.env.JWT_SECRET);
    comprobar.equal(sesion.id_usuario, 25);
    comprobar.equal(sesion.id_rol, 3);
    comprobar.equal(caso.verificar.mock.calls[0].arguments[0].audience, process.env.GOOGLE_CLIENT_ID);
    comprobar.equal(caso.guardar.mock.callCount(), 1);
  });
  it('rechaza tokens que Google no puede verificar', async prueba =>
  {
    const caso = prepararCaso(prueba);
    caso.verificar.mock.mockImplementation(async () =>
    {
      throw new Error('Token rechazado');
    });
    comprobar.equal((await caso.solicitar()).estado, 401);
    comprobar.equal(caso.guardar.mock.callCount(), 0);
  });
  it('rechaza correos sin verificar', async prueba =>
  {
    const caso = prepararCaso(prueba);
    caso.identidad.email_verified = false;
    comprobar.equal((await caso.solicitar()).estado, 401);
  });
  it('rechaza credenciales vacías y valores que no son cadenas', async prueba =>
  {
    const caso = prepararCaso(prueba);
    for(const token of ['', '   ', {}, 123])
    {
      comprobar.equal((await caso.solicitar({ token })).estado, 400);
    }
    comprobar.equal(caso.verificar.mock.callCount(), 0);
  });
  it('respeta la desactivación del acceso con Google', async prueba =>
  {
    const caso = prepararCaso(prueba);
    process.env.GOOGLE_AUTH_ENABLED = 'false';
    comprobar.equal((await caso.solicitar()).estado, 503);
  });
  it('identifica por sub y conserva el rol de un supervisor sin empresa', async prueba =>
  {
    const caso = prepararCaso(prueba, [
      { id_usuario: 1, id_rol: 1, google_id: 'google-123', activo: true, correo: 'anterior@gmail.com' }
    ]);
    const resultado = await caso.solicitar();
    comprobar.equal(resultado.datos.usuario.id_usuario, 1);
    comprobar.equal(resultado.datos.usuario.id_rol, 1);
    comprobar.equal(resultado.datos.require_company_info, false);
  });
  it('rechaza cuentas desactivadas o asociadas a otro sub', async prueba =>
  {
    const usuarios = [{ correo: 'cliente@gmail.com', google_id: 'otro-sub', activo: true }];
    const caso = prepararCaso(prueba, usuarios);
    comprobar.equal((await caso.solicitar()).estado, 403);
    usuarios[0].google_id = 'google-123';
    usuarios[0].activo = false;
    comprobar.equal((await caso.solicitar()).estado, 403);
  });
  it('vincula una cuenta Gmail existente conservando su rol', async prueba =>
  {
    const caso = prepararCaso(prueba, [
      { id_usuario: 5, correo: 'cliente@gmail.com', id_rol: 2, activo: true }
    ]);
    const resultado = await caso.solicitar();
    comprobar.equal(resultado.datos.usuario.id_rol, 2);
    comprobar.equal(resultado.datos.usuario.google_id, 'google-123');
    comprobar.equal(caso.guardar.mock.callCount(), 1);
  });
  it('exige contraseña para vincular un correo externo sin Workspace', async prueba =>
  {
    const caso = prepararCaso(prueba, [{ correo: 'cliente@example.test', activo: true }]);
    caso.identidad.email = 'cliente@example.test';
    comprobar.equal((await caso.solicitar()).estado, 409);
    comprobar.equal(caso.guardar.mock.callCount(), 0);
  });
});
