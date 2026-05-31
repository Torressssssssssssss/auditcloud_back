// Rutas de autenticacion: login, acceso con Google y completar perfil.
// backend/routes/auth.routes.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken'); // Para decodificar el token de Google
const { query } = require('../utils/db');
const { readJson, writeJson, getNextId } = require('../utils/jsonDb');
const { signToken, authenticate } = require('../utils/auth'); // Importamos las utilidades

function buildLoginUser(usuario) {
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
router.post('/login', async (req, res) => {
  try {
    const { correo, password } = req.body;
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
    const passwordValido = usuario && String(password ?? '') === String(usuario.password_hash ?? '');

    if (!usuario || !passwordValido) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const token = signToken(usuario);
    res.json({
      token,
      usuario: buildLoginUser(usuario)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
  try {
    console.log('[Autenticación Google] Petición recibida');

    const { token } = req.body;

    if (!token) {
      console.error('[Autenticación Google] Error: No se recibió el campo "token" en el cuerpo de la solicitud');
      return res.status(400).json({ message: 'Token es obligatorio' });
    }
    
    // Decodificar el token
    const googlePayload = jwt.decode(token); 
    
    if (!googlePayload) {
        console.error('[Autenticación Google] Error: No se pudo decodificar el token de Google');
        return res.status(400).json({ message: 'Token de Google inválido o corrupto' });
    }

    console.log('[Autenticación Google] Token decodificado exitosamente. Email:', googlePayload.email);

    const { email, name, sub } = googlePayload;

    const usuarios = await readJson('usuarios.json');
    let usuario = usuarios.find(u => u.correo === email);
    
    // Si no existe, lo creamos
    if (!usuario) {
      console.log('[Autenticación Google] Usuario nuevo detectado. Creando registro...');
      const idUsuario = await getNextId('usuarios.json', 'id_usuario');
      
      usuario = {
        id_usuario: idUsuario,
        id_empresa: null, 
        nombre: name,
        correo: email,
        password_hash: null,
        id_rol: 3, 
        activo: true,
        google_id: sub,
        creado_en: new Date().toISOString()
      };
      
      usuarios.push(usuario);
      await writeJson('usuarios.json', usuarios);
      console.log('[Autenticación Google] Usuario nuevo creado exitosamente. ID:', usuario.id_usuario);
    } else {
      console.log('[Autenticación Google] Usuario existente encontrado. ID:', usuario.id_usuario);
    }

    const jwtToken = signToken(usuario);

    res.json({
      token: jwtToken,
      usuario: usuario,
      require_company_info: !usuario.id_empresa 
    });

  } catch (error) {
    console.error('[Autenticación Google] Error crítico durante la autenticación:', error.message || error);
    res.status(500).json({ message: 'Error en autenticación Google' });
  }
});

// POST /api/auth/complete-profile
router.post('/complete-profile', authenticate, async (req, res) => {
  try {
    const { nombre_empresa, ciudad, estado, rfc } = req.body;
    const idUsuario = req.user.id_usuario;

    if (!nombre_empresa || !ciudad || !estado) {
      return res.status(400).json({ message: 'Faltan datos obligatorios' });
    }

    const usuarios = await readJson('usuarios.json');
    const empresas = await readJson('empresas.json');

    // Crear empresa
    const idEmpresa = await getNextId('empresas.json', 'id_empresa');
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
    await writeJson('empresas.json', empresas);

    // Asociar empresa al usuario
    const usuarioIdx = usuarios.findIndex(u => u.id_usuario === idUsuario);
    if (usuarioIdx !== -1) {
      usuarios[usuarioIdx].id_empresa = idEmpresa;
      await writeJson('usuarios.json', usuarios);
    }

    // Opcional: regenerar token con id_empresa
    // const newToken = signToken(usuarios[usuarioIdx]);

    res.json({ 
      message: 'Perfil completado exitosamente', 
      id_empresa: idEmpresa
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error completando perfil' });
  }
});

module.exports = router;