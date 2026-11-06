// Rutas de autenticacion: login, acceso con Google y completar perfil.
// backend/routes/auth.routes.js
const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { iniciarSesionGoogle } = require('../controllers/google-auth.controller');
const { query } = require('../utils/db');
const { listRows, saveRows, nextId } = require('../utils/mysqlStore');
const { signToken, authenticate } = require('../utils/auth'); // Importamos las utilidades

function buildLoginUser(usuario) 
{
  return {
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
}

// POST /api/auth/login (Login Normal)
router.post('/login', async (req, res) => 
{
  try 
{
    const { correo, password } = req.body;
    if(typeof correo !== 'string' || typeof password !== 'string' || !password) 
{
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }
    const usuarios = await query(
      `SELECT
        u.id_usuario,
        u.id_empresa,
        u.nombre,
        u.correo,
        u.password_hash,
        u.id_rol,
        u.activo,
        u.google_id,
        u.creado_en,
        r.nombre AS rol
      FROM usuarios u
      INNER JOIN roles r ON r.id_rol = u.id_rol
      WHERE u.correo = ?
        AND u.activo = 1
      LIMIT 1;`,
      [correo]
    );

    const usuario = usuarios[0];
    const contrasenaValida = usuario && typeof usuario.password_hash === 'string' &&
      await bcrypt.compare(password, usuario.password_hash);

    if(!usuario || !contrasenaValida) 
{
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const token = signToken(usuario);
    res.json({
      token,
      usuario: buildLoginUser(usuario)
    });
  }
 catch(error) 
{
    console.error(error);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});

// POST /api/auth/google
router.post('/google', iniciarSesionGoogle);

// POST /api/auth/complete-profile
router.post('/complete-profile', authenticate, async (req, res) => 
{
  try 
{
    const { nombre_empresa, ciudad, estado, rfc } = req.body;
    const idUsuario = req.user.id_usuario;

    if(!nombre_empresa || !ciudad || !estado) 
{
      return res.status(400).json({ message: 'Faltan datos obligatorios' });
    }

    const usuarios = await listRows('usuarios');
    const empresas = await listRows('empresas');

    // Crear empresa
    const idEmpresa = await nextId('empresas', 'id_empresa');
    const nuevaEmpresa = {
      id_empresa: idEmpresa,
      id_tipo_empresa: 2, // Tipo CLIENTE
      nombre: nombre_empresa,
      rfc: rfc || null,
      giro: null,
      direccion: null,
      ciudad: ciudad,
      estado: estado,
      pais: 'México',
      contacto_nombre: req.user.nombre,
      contacto_correo: req.user.correo,
      contacto_telefono: null,
      activo: true
    };

    empresas.push(nuevaEmpresa);
    await saveRows('empresas', empresas);

    // Asociar empresa al usuario
    const usuarioIdx = usuarios.findIndex(u => u.id_usuario === idUsuario);
    if(usuarioIdx !== -1) 
{
      usuarios[usuarioIdx].id_empresa = idEmpresa;
      await saveRows('usuarios', usuarios);
    }

    // Renovar la sesión con la empresa asociada.
    const usuarioActualizado = usuarios[usuarioIdx];

    res.json({ 
      message: 'Perfil completado exitosamente', 
      id_empresa: idEmpresa,
      token: signToken(usuarioActualizado),
      usuario: buildLoginUser(usuarioActualizado)
    });

  }
 catch(error) 
{
    console.error(error);
    res.status(500).json({ message: 'Error completando perfil' });
  }
});

module.exports = require('../utils/sqlRouter').transactionalRouter(router);
