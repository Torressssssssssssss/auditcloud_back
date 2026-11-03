const { verificarToken } = require('../utils/auth');
const { query, afterCommit } = require('../utils/db');

function salaEmpresa(idEmpresa)
{
  return `direccion:empresa:${idEmpresa}`;
}

async function autenticarConexion(conexion, siguiente)
{
  try
  {
    const token = conexion.handshake.auth?.token;
    if(typeof token !== 'string' || token.length > 8192) throw new Error();
    const usuario = verificarToken(token);
    if(usuario.id_rol !== 1 || !Number.isInteger(usuario.id_empresa) || usuario.id_empresa < 1 ||
      !Number.isInteger(usuario.id_usuario) || !Number.isFinite(usuario.exp)) throw new Error();
    const [vigente] = await query(`SELECT id_usuario FROM usuarios
      WHERE id_usuario=? AND id_empresa=? AND id_rol=1 AND activo=1`,
    [usuario.id_usuario, usuario.id_empresa]);
    if(!vigente) throw new Error();
    conexion.data.usuario = usuario;
    siguiente();
  }
  catch
  {
    siguiente(new Error('Acceso al dashboard no autorizado.'));
  }
}

function configurarWebsocket(servidor, opcionesCors)
{
  const { Server: ServidorSocket } = require('socket.io');
  const conexiones = new ServidorSocket(servidor, {
    path: '/api/socket.io',
    cors: opcionesCors,
    maxHttpBufferSize: 16384,
    allowRequest(solicitud, responder)
    {
      opcionesCors.origin(solicitud.headers.origin, (error, permitido) =>
      {
        responder(null, !error && permitido === true);
      });
    }
  });
  conexiones.use(autenticarConexion);
  conexiones.on('connection', conexion =>
  {
    const usuario = conexion.data.usuario;
    conexion.join(salaEmpresa(usuario.id_empresa));
    const vigencia = Math.max(0, Math.min(usuario.exp * 1000 - Date.now(), 2147483647));
    const temporizador = setTimeout(() => conexion.disconnect(true), vigencia);
    temporizador.unref();
    conexion.on('disconnect', () => clearTimeout(temporizador));
  });
  return conexiones;
}

function programarNuevoConsumo(aplicacion, idEmpresa, consumo)
{
  const evento = { ...consumo };
  afterCommit(() =>
  {
    aplicacion.get('socketio')?.to(salaEmpresa(idEmpresa)).emit('nuevo_consumo', evento);
  });
}

module.exports = { configurarWebsocket, autenticarConexion, salaEmpresa, programarNuevoConsumo };
