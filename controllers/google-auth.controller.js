const { OAuth2Client: ClienteOAuthGoogle } = require('google-auth-library');
const { listRows: listarFilas, saveRows: guardarFilas, nextId: siguienteId } = require('../utils/mysqlStore');
const { signToken: firmarToken } = require('../utils/auth');

const clienteGoogle = new ClienteOAuthGoogle();

async function iniciarSesionGoogle(solicitud, respuesta)
{
  const identificadorCliente = process.env.GOOGLE_CLIENT_ID?.trim() || '';
  if(process.env.GOOGLE_AUTH_ENABLED !== 'true' ||
      !/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(identificadorCliente))
  {
    return respuesta.status(503).json({ message: 'Inicio de sesión con Google no disponible' });
  }

  const credencial = solicitud.body?.token;
  if(typeof credencial !== 'string' || !credencial.trim())
  {
    return respuesta.status(400).json({ message: 'Token es obligatorio' });
  }

  let identidad;
  try
  {
    const verificacion = await clienteGoogle.verifyIdToken(
    {
      idToken: credencial,
      audience: identificadorCliente
    });
    identidad = verificacion.getPayload();
    if(!identidad?.sub || !identidad.email || identidad.email_verified !== true)
    {
      return respuesta.status(401).json({ message: 'Token de Google inválido' });
    }
  }
  catch
  {
    return respuesta.status(401).json({ message: 'Token de Google inválido' });
  }

  try
  {
    const correo = identidad.email.toLowerCase();
    const usuarios = await listarFilas('usuarios');
    let usuario = usuarios.find(candidato => candidato.google_id === identidad.sub);
    if(!usuario)
    {
      usuario = usuarios.find(candidato => candidato.correo.toLowerCase() === correo);
    }

    if(usuario)
    {
      if(!usuario.activo || (usuario.google_id && usuario.google_id !== identidad.sub))
      {
        return respuesta.status(403).json({ message: 'Cuenta no disponible' });
      }

      if(!usuario.google_id)
      {
        // Google solo acredita la propiedad actual del correo para Gmail o Workspace verificado.
        if(!correo.endsWith('@gmail.com') && !identidad.hd)
        {
          return respuesta.status(409).json(
          {
            message: 'Ya existe una cuenta con este correo. Inicia sesión con tu contraseña.'
          });
        }
        usuario.google_id = identidad.sub;
        await guardarFilas('usuarios', usuarios);
      }
    }
    else
    {
      usuario =
      {
        id_usuario: await siguienteId('usuarios', 'id_usuario'),
        id_empresa: null,
        nombre: identidad.name || correo.split('@')[0],
        correo,
        password_hash: null,
        id_rol: 3,
        activo: true,
        google_id: identidad.sub,
        creado_en: new Date().toISOString()
      };
      usuarios.push(usuario);
      await guardarFilas('usuarios', usuarios);
    }

    const usuarioPublico =
    {
      id_usuario: usuario.id_usuario,
      id_empresa: usuario.id_empresa,
      nombre: usuario.nombre,
      correo: usuario.correo,
      id_rol: usuario.id_rol,
      rol: usuario.rol,
      activo: usuario.activo,
      google_id: usuario.google_id,
      creado_en: usuario.creado_en
    };
    return respuesta.json(
    {
      token: firmarToken(usuario),
      usuario: usuarioPublico,
      require_company_info: Number(usuario.id_rol) === 3 && !usuario.id_empresa
    });
  }
  catch(error)
  {
    console.error('[Autenticación Google]', error.code || error.name);
    return respuesta.status(500).json({ message: 'Error en autenticación Google' });
  }
}

module.exports = { iniciarSesionGoogle };
