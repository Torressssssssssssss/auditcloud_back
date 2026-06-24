// Rutas de supervisor: gestion de auditores, empresa, pagos y evidencias.
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('../utils/db');
const { readJson, writeJson, getNextId, crearNotificacion } = require('../utils/jsonDb');
const { authenticate, authorize } = require('../utils/auth');
const { uploadFileToFirebase } = require('../utils/firebaseStorage');
const { normalizeConversation, isCommercialConversation, isAuditConversation } = require('../utils/conversationContext');
const { indexAuditoria, updateAuditoria } = require('../services/elasticsearchAuditorias.service');

// Configuracion de carga de archivos
const storage = multer.memoryStorage(); // Para Firebase

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no soportado. Solo PDF.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: fileFilter
});

// Gestion de auditores

// GET /api/supervisor/auditores/:idEmpresa
router.get('/auditores/:idEmpresa', authenticate, authorize([1]), async (req, res) => {
  const idEmpresa = Number(req.params.idEmpresa);
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);

  if (req.user.id_empresa !== idEmpresa) {
      return res.status(403).json({ message: 'No tienes permiso para ver auditores de otra empresa.' });
  }

  try {
    const rows = await query(
      `SELECT id_usuario, id_empresa, nombre, correo, id_rol, activo, creado_en
       FROM usuarios
       WHERE id_empresa = ?
         AND id_rol = 2
         AND activo = 1
       ORDER BY nombre ASC;`,
      [idEmpresa]
    );

    if (rows.length > 0) {
      const start = (page - 1) * limit;
      return res.json({ total: rows.length, page, limit, data: rows.slice(start, start + limit) });
    }
  } catch (error) {
    if (error?.code !== 'DB_NOT_CONFIGURED') {
      console.warn('No fue posible listar auditores desde MySQL, usando JSON:', error?.code || error?.message || error);
    }
  }

  const usuarios = await readJson('usuarios.json');
  const all = usuarios.filter(
    u => u.id_empresa === idEmpresa && u.id_rol === 2 && u.activo
  );
  const start = (page - 1) * limit;
  const data = all.slice(start, start + limit);
  res.json({ total: all.length, page, limit, data });
});

// POST /api/supervisor/auditores
router.post('/auditores', authenticate, authorize([1]), async (req, res) => {
  const { id_empresa, nombre, correo, password } = req.body;

  if (!id_empresa || !nombre || !correo || !password) {
    return res.status(400).json({ message: 'Todos los campos son obligatorios' });
  }

  if (req.user.id_empresa !== Number(id_empresa)) {
      return res.status(403).json({ message: 'No puedes crear auditores para otra empresa.' });
  }

  const usuarios = await readJson('usuarios.json');
  const empresas = await readJson('empresas.json');
  const existeEmpresa = empresas.some(e => e.id_empresa === Number(id_empresa) && e.activo);
  if (!existeEmpresa) {
    return res.status(404).json({ message: 'Empresa no encontrada o inactiva' });
  }

  const yaExiste = usuarios.find(u => u.correo === correo);
  if (yaExiste) {
    return res.status(400).json({ message: 'Ese correo ya está registrado' });
  }

  const idNuevo = await getNextId('usuarios.json', 'id_usuario');

  const nuevoAuditor = {
    id_usuario: idNuevo,
    id_empresa: Number(id_empresa),
    nombre,
    correo,
    password_hash: password,
    id_rol: 2,
    activo: true,
    creado_en: new Date().toISOString()
  };

  usuarios.push(nuevoAuditor);
  await writeJson('usuarios.json', usuarios);

  res.status(201).json({
    message: 'Auditor creado correctamente',
    auditor: {
      id_usuario: nuevoAuditor.id_usuario,
      id_empresa: nuevoAuditor.id_empresa,
      nombre: nuevoAuditor.nombre,
      correo: nuevoAuditor.correo,
      id_rol: nuevoAuditor.id_rol
    }
  });
});

// Configuracion de empresa

// GET /api/supervisor/empresa/:id
router.get('/empresa/:id', authenticate, authorize([1]), async (req, res) => {
  try {
    const idEmpresa = Number(req.params.id);
    const idUsuario = req.user.id_usuario;

    const empresas = await readJson('empresas.json');
    const usuarios = await readJson('usuarios.json');
    const empresaModulos = await readJson('empresa_modulos.json');

    const empresa = empresas.find(e => e.id_empresa === idEmpresa && e.id_tipo_empresa === 1 && e.activo);
    if (!empresa) {
      return res.status(404).json({ message: 'Empresa auditora no encontrada' });
    }

    const usuario = usuarios.find(u => u.id_usuario === idUsuario && u.id_rol === 1 && u.activo);
    if (!usuario || usuario.id_empresa !== idEmpresa) {
      return res.status(403).json({ message: 'No tienes permisos para acceder a esta empresa' });
    }

    const modulos = empresaModulos
      .filter(em => em.id_empresa === idEmpresa)
      .map(em => em.id_modulo);

    res.json({
      id_empresa: empresa.id_empresa,
      nombre: empresa.nombre,
      rfc: empresa.rfc || null,
      direccion: empresa.direccion || null,
      telefono: empresa.contacto_telefono || null,
      modulos: modulos
    });
  } catch (error) {
    console.error('Error config empresa:', error);
    res.status(500).json({ message: 'Error al obtener configuración' });
  }
});

// PUT /api/supervisor/empresa/:id
router.put('/empresa/:id', authenticate, authorize([1]), async (req, res) => {
  try {
    const idEmpresa = Number(req.params.id);
    const { nombre, rfc, direccion, telefono, modulos } = req.body;
    const idUsuario = req.user.id_usuario;

    if (!nombre) return res.status(400).json({ message: 'nombre es obligatorio' });

    const empresas = await readJson('empresas.json');
    const usuarios = await readJson('usuarios.json');
    const empresaModulos = await readJson('empresa_modulos.json');
    const modulosAmbientales = await readJson('modulos_ambientales.json');

    const empresaIdx = empresas.findIndex(e => e.id_empresa === idEmpresa && e.id_tipo_empresa === 1 && e.activo);
    if (empresaIdx === -1) return res.status(404).json({ message: 'Empresa no encontrada' });

    const usuario = usuarios.find(u => u.id_usuario === idUsuario && u.id_rol === 1 && u.activo);
    if (!usuario || usuario.id_empresa !== idEmpresa) {
      return res.status(403).json({ message: 'No tienes permisos para modificar esta empresa' });
    }

    // Validar modulos
    if (modulos && Array.isArray(modulos)) {
      for (const idModulo of modulos) {
        const moduloValido = modulosAmbientales.some(m => m.id_modulo === Number(idModulo));
        if (!moduloValido) return res.status(400).json({ message: `Módulo ${idModulo} no válido` });
      }
    }

    // Guardar datos de empresa
    empresas[empresaIdx].nombre = nombre;
    empresas[empresaIdx].rfc = rfc || null;
    empresas[empresaIdx].direccion = direccion || null;
    empresas[empresaIdx].contacto_telefono = telefono || null;

    await writeJson('empresas.json', empresas);

    // Guardar modulos
    const modulosActualizados = empresaModulos.filter(em => em.id_empresa !== idEmpresa);
    
    if (modulos && Array.isArray(modulos)) {
      for (const idModulo of modulos) {
        const idEmpresaModulo = await getNextId('empresa_modulos.json', 'id_empresa_modulo');
        modulosActualizados.push({
          id_empresa_modulo: idEmpresaModulo,
          id_empresa: idEmpresa,
          id_modulo: Number(idModulo),
          registrado_en: new Date().toISOString()
        });
      }
    }

    await writeJson('empresa_modulos.json', modulosActualizados);

    res.json({
      id_empresa: empresas[empresaIdx].id_empresa,
      nombre: empresas[empresaIdx].nombre,
      rfc: empresas[empresaIdx].rfc,
      modulos: modulos.map(Number)
    });
  } catch (error) {
    console.error('Error guardando empresa:', error);
    res.status(500).json({ message: 'Error al guardar configuración' });
  }
});

// Solicitudes de pago

function empresaEsActiva(empresa = {}) {
  return empresa.activo !== false && empresa.activa !== false;
}

async function validarDestinoSolicitudPago(idEmpresaDestino, idCliente) {
  const empresaId = Number(idEmpresaDestino);
  const clienteId = Number(idCliente);

  try {
    const [empresaRows, usuarioRows] = await Promise.all([
      query(
        `SELECT id_empresa, nombre, id_tipo_empresa, activo
         FROM empresas
         WHERE id_empresa = ?
         LIMIT 1;`,
        [empresaId]
      ),
      query(
        `SELECT u.id_usuario, u.id_empresa, u.nombre, u.id_rol, u.activo, e.nombre AS nombre_empresa
         FROM usuarios u
         LEFT JOIN empresas e ON e.id_empresa = u.id_empresa
         WHERE u.id_usuario = ?
         LIMIT 1;`,
        [clienteId]
      )
    ]);

    const empresaMysql = empresaRows[0];
    const usuarioMysql = usuarioRows[0];

    if (empresaMysql && usuarioMysql) {
      const empresaValida = Number(empresaMysql.activo) === 1 && Number(empresaMysql.id_tipo_empresa) === 2;
      const usuarioValido = Number(usuarioMysql.activo) === 1 && Number(usuarioMysql.id_rol) === 3 && Number(usuarioMysql.id_empresa) === empresaId;

      if (empresaValida && usuarioValido) {
        return {
          empresa: {
            id_empresa: Number(empresaMysql.id_empresa),
            nombre: empresaMysql.nombre || 'Empresa Cliente'
          },
          usuario: {
            id_usuario: Number(usuarioMysql.id_usuario),
            id_empresa: Number(usuarioMysql.id_empresa),
            nombre: usuarioMysql.nombre || 'Usuario',
            nombre_empresa: usuarioMysql.nombre_empresa || empresaMysql.nombre || 'Empresa Cliente'
          },
          origen: 'mysql'
        };
      }

      if (!empresaValida) {
        return { error: 'Empresa cliente no encontrada' };
      }

      return { error: 'Usuario cliente no encontrado o no pertenece a la empresa indicada' };
    }
  } catch (error) {
    console.warn('Validación MySQL no disponible para solicitud de pago, usando JSON como respaldo:', error?.code || error?.message || error);
  }

  const empresasJson = await readJson('empresas.json');
  const usuariosJson = await readJson('usuarios.json');

  const empresaJson = empresasJson.find(e => Number(e.id_empresa) === empresaId && empresaEsActiva(e));
  const usuarioJson = usuariosJson.find(u => Number(u.id_usuario) === clienteId && u.id_rol === 3 && empresaEsActiva(u) && Number(u.id_empresa) === empresaId);

  if (!empresaJson) {
    return { error: 'Empresa cliente no encontrada' };
  }

  if (!usuarioJson) {
    return { error: 'Usuario cliente no encontrado o no pertenece a la empresa indicada' };
  }

  return {
    empresa: {
      id_empresa: Number(empresaJson.id_empresa),
      nombre: empresaJson.nombre || 'Empresa Cliente'
    },
    usuario: {
      id_usuario: Number(usuarioJson.id_usuario),
      id_empresa: Number(usuarioJson.id_empresa),
      nombre: usuarioJson.nombre || 'Usuario',
      nombre_empresa: empresaJson.nombre || 'Empresa Cliente'
    },
    origen: 'json'
  };
}

// POST /api/supervisor/solicitudes-pago
router.post('/solicitudes-pago', authenticate, authorize([1]), async (req, res) => {
  try {
    const { id_empresa: id_empresa_destino, id_cliente, monto, concepto } = req.body;
    const mi_id_empresa = req.user.id_empresa;

    if (!monto || !concepto) {
      return res.status(400).json({ message: 'monto y concepto son obligatorios' });
    }

    const solicitudes = await readJson('solicitudes_pago.json');
    const idSolicitud = await getNextId('solicitudes_pago.json', 'id_solicitud');
    if (!id_empresa_destino || !id_cliente) {
      return res.status(400).json({ message: 'id_empresa e id_cliente son obligatorios' });
    }

    const destino = await validarDestinoSolicitudPago(id_empresa_destino, id_cliente);
    if (destino.error) {
      return res.status(404).json({ message: destino.error });
    }

    const creadoEn = new Date();
    const creadoEnMysql = creadoEn.toISOString().slice(0, 19).replace('T', ' ');

    const nueva = {
      id_solicitud: idSolicitud,
      id_empresa: Number(mi_id_empresa), // Supervisor es el dueño
      id_empresa_auditora: Number(mi_id_empresa),
      id_empresa_cliente: Number(destino.usuario.id_empresa), // Cliente es el destino real
      id_cliente: Number(destino.usuario.id_usuario),
      monto: Number(monto),
      concepto,
      id_estado: 1, // Pendiente
      creado_en: creadoEn.toISOString(),
      creado_por_supervisor: req.user.id_usuario
    };

    try {
      await query(
        `INSERT INTO solicitudes_pago (
          id_solicitud,
          id_empresa,
          id_empresa_auditora,
          id_empresa_cliente,
          id_cliente,
          monto,
          concepto,
          id_estado,
          creado_en,
          creado_por_supervisor,
          creado_por_auditor,
          pagada_en,
          paypal_order_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL);`,
        [
          nueva.id_solicitud,
          nueva.id_empresa,
          nueva.id_empresa_auditora,
          nueva.id_empresa_cliente,
          nueva.id_cliente,
          nueva.monto,
          nueva.concepto,
          nueva.id_estado,
          creadoEnMysql,
          nueva.creado_por_supervisor
        ]
      );
    } catch (error) {
      console.error('Error guardando solicitud en MySQL:', error?.code || error?.message || error);
    }

    solicitudes.push(nueva);
    await writeJson('solicitudes_pago.json', solicitudes);
    
    res.status(201).json({ message: 'Solicitud creada con éxito', solicitud: nueva });

  } catch (error) {
    console.error('Error creando solicitud:', error);
    res.status(500).json({ message: 'Error interno' });
  }
});

// GET /api/supervisor/solicitudes-pago
router.get('/solicitudes-pago', authenticate, authorize([1]), async (req, res) => {
  try {
    const idEmpresaAuditora = Number(req.user.id_empresa);
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);

    const solicitudes = await readJson('solicitudes_pago.json');
    const empresas = await readJson('empresas.json');

    // Filtrar solicitudes de esta empresa auditora
    const misSolicitudes = solicitudes.filter(s => {
      const ownerId = s.id_empresa_auditora ? Number(s.id_empresa_auditora) : Number(s.id_empresa);
      return ownerId === idEmpresaAuditora;
    });

    const data = misSolicitudes.map(s => {
      let nombreCliente = 'Desconocido';
      const targetId = s.id_empresa_cliente || (s.id_empresa !== idEmpresaAuditora ? s.id_empresa : null);
      
      if (targetId) {
        const empresa = empresas.find(e => e.id_empresa === Number(targetId));
        if (empresa) nombreCliente = empresa.nombre;
      }
      
      return {
        ...s,
        nombre_empresa_cliente: nombreCliente,
        es_mio: s.creado_por_supervisor === req.user.id_usuario
      };
    });

    data.sort((a, b) => {
      if (a.id_estado === b.id_estado) return new Date(b.creado_en) - new Date(a.creado_en);
      return a.id_estado - b.id_estado;
    });

    const start = (page - 1) * limit;
    res.json({ total: data.length, page, limit, data: data.slice(start, start + limit) });

  } catch (error) {
    console.error('Error obteniendo pagos:', error);
    res.status(500).json({ message: 'Error interno' });
  }
});

function estaActivo(item = {}) {
  return item.activo !== false && item.activa !== false;
}

function estadoOperativoCartera(solicitud, auditoria, asignacion) {
  if (auditoria?.id_estado === 3) {
    return 'Finalizada';
  }

  if (auditoria?.id_estado === 2) {
    return 'Auditoría activa';
  }

  if (asignacion) {
    return 'Auditor asignado';
  }

  return 'Pendiente de asignar auditor';
}

async function cargarAuditorAsignable(idAuditor, idEmpresaAuditora) {
  const auditorId = Number(idAuditor);
  const empresaId = Number(idEmpresaAuditora);

  try {
    const rows = await query(
      `SELECT id_usuario, id_empresa, nombre, correo, id_rol, activo
       FROM usuarios
       WHERE id_usuario = ?
         AND id_empresa = ?
         AND id_rol = 2
         AND activo = 1
       LIMIT 1;`,
      [auditorId, empresaId]
    );
    if (rows[0]) return rows[0];
  } catch (error) {
    if (error?.code !== 'DB_NOT_CONFIGURED') {
      console.warn('No fue posible validar auditor en MySQL, usando JSON:', error?.code || error?.message || error);
    }
  }

  const usuarios = await readJson('usuarios.json');
  return usuarios.find(u =>
    Number(u.id_usuario) === auditorId &&
    Number(u.id_empresa) === empresaId &&
    Number(u.id_rol) === 2 &&
    u.activo !== false
  ) || null;
}

async function cargarClienteEmpresaCartera(idCliente, usuarios, empresas) {
  const usuarioId = Number(idCliente);
  const usuarioJson = usuarios.find(u => Number(u.id_usuario) === usuarioId);
  const empresaJson = usuarioJson?.id_empresa
    ? empresas.find(e => Number(e.id_empresa) === Number(usuarioJson.id_empresa))
    : null;

  if (usuarioJson) {
    return { usuarioCliente: usuarioJson, empresaCliente: empresaJson || null };
  }

  try {
    const rows = await query(
      `SELECT
        u.id_usuario,
        u.id_empresa,
        u.nombre,
        u.correo,
        e.nombre AS nombre_empresa,
        e.ciudad,
        e.pais,
        e.contacto_nombre,
        e.activo
       FROM usuarios u
       LEFT JOIN empresas e ON e.id_empresa = u.id_empresa
       WHERE u.id_usuario = ?
       LIMIT 1;`,
      [usuarioId]
    );
    const row = rows[0];
    if (row) {
      return {
        usuarioCliente: {
          id_usuario: Number(row.id_usuario),
          id_empresa: row.id_empresa ? Number(row.id_empresa) : null,
          nombre: row.nombre,
          correo: row.correo,
          activo: true
        },
        empresaCliente: row.id_empresa ? {
          id_empresa: Number(row.id_empresa),
          nombre: row.nombre_empresa || 'Empresa Cliente',
          ciudad: row.ciudad || null,
          pais: row.pais || 'México',
          contacto_nombre: row.contacto_nombre || row.nombre,
          activo: row.activo !== 0
        } : null
      };
    }
  } catch (error) {
    if (error?.code !== 'DB_NOT_CONFIGURED') {
      console.warn('No fue posible cargar cliente de cartera desde MySQL:', error?.code || error?.message || error);
    }
  }

  return { usuarioCliente: null, empresaCliente: null };
}

async function cargarUsuarioPorId(idUsuario) {
  const usuarioId = Number(idUsuario);
  const usuarios = await readJson('usuarios.json');
  const usuarioJson = usuarios.find(u => Number(u.id_usuario) === usuarioId);
  if (usuarioJson) return usuarioJson;

  try {
    const rows = await query(
      `SELECT id_usuario, id_empresa, nombre, correo, id_rol, activo
       FROM usuarios
       WHERE id_usuario = ?
       LIMIT 1;`,
      [usuarioId]
    );
    return rows[0] || null;
  } catch (error) {
    return null;
  }
}

function construirRegistroCartera({ solicitud, empresaCliente, usuarioCliente, auditoria, asignacion, auditor }) {
  return {
    id_empresa: empresaCliente?.id_empresa || solicitud.id_empresa_cliente,
    nombre: empresaCliente?.nombre || 'Empresa Cliente',
    ciudad: empresaCliente?.ciudad || null,
    pais: empresaCliente?.pais || 'México',
    contacto: usuarioCliente?.nombre || empresaCliente?.contacto_nombre || 'Cliente',
    activo: empresaCliente ? estaActivo(empresaCliente) : true,
    id_cliente: solicitud.id_cliente,
    id_solicitud: solicitud.id_solicitud,
    id_solicitud_pago: solicitud.id_solicitud,
    concepto: solicitud.concepto,
    monto: solicitud.monto,
    id_estado_pago: solicitud.id_estado,
    pagada_en: solicitud.pagada_en || null,
    id_auditoria: auditoria?.id_auditoria || null,
    id_estado_auditoria: auditoria?.id_estado || null,
    total_auditorias: auditoria ? 1 : 0,
    estado_operativo: estadoOperativoCartera(solicitud, auditoria, asignacion),
    pendiente_asignar_auditor: Number(solicitud.id_estado) === 2 && !asignacion,
    auditor_asignado: auditor ? {
      id_usuario: auditor.id_usuario,
      nombre: auditor.nombre,
      correo: auditor.correo
    } : null
  };
}

// GET /api/supervisor/clientes-cartera
// Empresas con pagos aprobados y su siguiente paso operativo.
router.get('/clientes-cartera', authenticate, authorize([1]), async (req, res) => {
  try {
    const idEmpresaAuditora = Number(req.user.id_empresa);
    const solicitudes = await readJson('solicitudes_pago.json');
    const auditorias = await readJson('auditorias.json');
    const participantes = await readJson('auditoria_participantes.json');
    const usuarios = await readJson('usuarios.json');
    const empresas = await readJson('empresas.json');

    const pagadas = solicitudes.filter(s => {
      const ownerId = s.id_empresa_auditora ? Number(s.id_empresa_auditora) : Number(s.id_empresa);
      return ownerId === idEmpresaAuditora && Number(s.id_estado) === 2;
    });

    const registros = await Promise.all(pagadas.map(async (solicitud) => {
      const auditoria = auditorias.find(a =>
        Number(a.id_empresa_auditora) === idEmpresaAuditora &&
        Number(a.id_solicitud_pago) === Number(solicitud.id_solicitud)
      );
      const asignacion = auditoria
        ? participantes.find(p => Number(p.id_auditoria) === Number(auditoria.id_auditoria))
        : null;
      const auditor = asignacion
        ? await cargarUsuarioPorId(asignacion.id_auditor)
        : null;
      const datosCliente = await cargarClienteEmpresaCartera(solicitud.id_cliente, usuarios, empresas);
      const usuarioCliente = datosCliente.usuarioCliente;
      const idEmpresaCliente = solicitud.id_empresa_cliente || usuarioCliente?.id_empresa;
      const empresaCliente = datosCliente.empresaCliente || empresas.find(e => Number(e.id_empresa) === Number(idEmpresaCliente));

      return construirRegistroCartera({ solicitud, empresaCliente, usuarioCliente, auditoria, asignacion, auditor });
    }));

    registros.sort((a, b) => new Date(b.pagada_en || 0) - new Date(a.pagada_en || 0));
    res.json(registros);
  } catch (error) {
    console.error('Error cargando cartera de clientes:', error);
    res.status(500).json({ message: 'Error cargando cartera de clientes' });
  }
});

// POST /api/supervisor/solicitudes-pago/:idSolicitud/asignar-auditor
// Crea/reusa una auditoría para una solicitud pagada y asigna auditor una sola vez.
router.post('/solicitudes-pago/:idSolicitud/asignar-auditor', authenticate, authorize([1]), async (req, res) => {
  try {
    const idSolicitud = Number(req.params.idSolicitud);
    const idAuditor = Number(req.body.id_auditor);
    const idEmpresaAuditora = Number(req.user.id_empresa);

    if (!Number.isInteger(idSolicitud) || idSolicitud <= 0) {
      return res.status(400).json({ message: 'Solicitud inválida' });
    }

    if (!Number.isInteger(idAuditor) || idAuditor <= 0) {
      return res.status(400).json({ message: 'id_auditor es obligatorio' });
    }

    const solicitudes = await readJson('solicitudes_pago.json');
    const auditorias = await readJson('auditorias.json');
    const participantes = await readJson('auditoria_participantes.json');
    const usuarios = await readJson('usuarios.json');
    const conversaciones = (await readJson('conversaciones.json')).map(normalizeConversation);

    const solicitud = solicitudes.find(s => Number(s.id_solicitud) === idSolicitud);
    const ownerId = solicitud?.id_empresa_auditora ? Number(solicitud.id_empresa_auditora) : Number(solicitud?.id_empresa);
    if (!solicitud || ownerId !== idEmpresaAuditora) {
      return res.status(404).json({ message: 'Solicitud de pago no encontrada' });
    }

    if (Number(solicitud.id_estado) !== 2) {
      return res.status(400).json({ message: 'La solicitud debe estar pagada antes de asignar auditor' });
    }

    const auditor = await cargarAuditorAsignable(idAuditor, idEmpresaAuditora);
    if (!auditor) {
      return res.status(404).json({ message: 'Auditor no encontrado para esta empresa auditora' });
    }

    const idCliente = Number(solicitud.id_cliente);
    if (!Number.isInteger(idCliente) || idCliente <= 0) {
      return res.status(400).json({ message: 'La solicitud no tiene cliente relacionado' });
    }

    let auditoria = auditorias.find(a =>
      Number(a.id_empresa_auditora) === idEmpresaAuditora &&
      Number(a.id_solicitud_pago) === idSolicitud
    );

    if (!auditoria) {
      auditoria = {
        id_auditoria: await getNextId('auditorias.json', 'id_auditoria'),
        id_empresa_auditora: idEmpresaAuditora,
        id_cliente: idCliente,
        id_empresa_cliente: solicitud.id_empresa_cliente || null,
        id_solicitud_pago: idSolicitud,
        id_estado: 1,
        objetivo: solicitud.concepto || 'Auditoría derivada de solicitud de pago',
        monto: solicitud.monto,
        creada_en: new Date().toISOString(),
        creado_por_supervisor: req.user.id_usuario
      };
      auditorias.push(auditoria);
      await writeJson('auditorias.json', auditorias);
      // Elasticsearch es copia para visualizacion; si falla, no revierte la operacion principal.
      await indexAuditoria(auditoria);
    }

    const actuales = participantes.filter(p => Number(p.id_auditoria) === Number(auditoria.id_auditoria));
    if (actuales.length > 0) {
      if (actuales.length === 1 && Number(actuales[0].id_auditor) === idAuditor) {
        return res.status(400).json({ message: 'Este auditor ya está asignado.' });
      }
      return res.status(409).json({ message: 'La auditoría ya tiene un auditor asignado. Usa Cambiar auditor.' });
    }

    const resultadoAsignacion = await guardarAsignacionUnicaAuditor({
      idAuditoria: auditoria.id_auditoria,
      idAuditor,
      req,
      reemplazar: false
    });

    res.status(200).json({
      message: 'Auditor asignado correctamente',
      auditoria,
      participante: resultadoAsignacion.participante
    });
  } catch (error) {
    console.error('Error asignando auditor desde solicitud:', error);
    res.status(500).json({ message: 'Error asignando auditor' });
  }
});

async function cargarClienteAuditoriaSupervisor(idCliente, usuarios, empresas) {
  const usuarioJson = usuarios.find(u => Number(u.id_usuario) === Number(idCliente));
  const empresaJson = usuarioJson?.id_empresa
    ? empresas.find(e => Number(e.id_empresa) === Number(usuarioJson.id_empresa))
    : null;

  if (usuarioJson) {
    return {
      usuario: usuarioJson,
      empresa: empresaJson || null,
      cliente: {
        id_usuario: usuarioJson.id_usuario,
        nombre: usuarioJson.nombre,
        correo: usuarioJson.correo,
        nombre_empresa: empresaJson?.nombre || usuarioJson.nombre_empresa || null
      }
    };
  }

  try {
    const rows = await query(
      `SELECT u.id_usuario, u.nombre, u.correo, u.id_empresa, e.nombre AS nombre_empresa
       FROM usuarios u
       LEFT JOIN empresas e ON e.id_empresa = u.id_empresa
       WHERE u.id_usuario = ?
       LIMIT 1;`,
      [Number(idCliente)]
    );
    const row = rows[0];
    if (row) {
      return {
        usuario: row,
        empresa: row.id_empresa ? { id_empresa: Number(row.id_empresa), nombre: row.nombre_empresa } : null,
        cliente: {
          id_usuario: Number(row.id_usuario),
          nombre: row.nombre,
          correo: row.correo,
          nombre_empresa: row.nombre_empresa || null
        }
      };
    }
  } catch (error) {
    if (error?.code !== 'DB_NOT_CONFIGURED') {
      console.warn('No fue posible enriquecer cliente desde MySQL:', error?.code || error?.message || error);
    }
  }

  return {
    usuario: null,
    empresa: null,
    cliente: { id_usuario: Number(idCliente), nombre: null, correo: null, nombre_empresa: null }
  };
}

function normalizarTextoModulo(valor) {
  return String(valor || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/s+/g, ' ');
}

async function resolverIdModulo(input) {
  const modulosAmbientales = await readJson('modulos_ambientales.json');
  const valorNumerico = Number(input);
  if (Number.isInteger(valorNumerico) && valorNumerico > 0) {
    const existe = modulosAmbientales.some(m => Number(m.id_modulo) === valorNumerico);
    return existe ? valorNumerico : null;
  }

  const normalizado = normalizarTextoModulo(input);
  const modulo = modulosAmbientales.find(m =>
    normalizarTextoModulo(m.nombre) === normalizado ||
    normalizarTextoModulo(m.clave) === normalizado
  );
  return modulo ? Number(modulo.id_modulo) : null;
}

function modulosUnicosPorAuditoria(auditoriaModulos, idAuditoria) {
  const vistos = new Set();
  return auditoriaModulos
    .filter(am => Number(am.id_auditoria) === Number(idAuditoria))
    .map(am => Number(am.id_modulo))
    .filter(idModulo => {
      if (vistos.has(idModulo)) return false;
      vistos.add(idModulo);
      return true;
    });
}

function actualizarConversacionAuditor(conversaciones, auditoria, idAuditor, idSupervisor) {
  const idxConversacion = conversaciones.findIndex(c =>
    isAuditConversation(c) &&
    Number(c.id_auditoria) === Number(auditoria.id_auditoria) &&
    Number(c.id_cliente) === Number(auditoria.id_cliente) &&
    Number(c.id_empresa_auditora) === Number(auditoria.id_empresa_auditora) &&
    c.activo
  );

  if (idxConversacion === -1) {
    conversaciones.push({
      id_conversacion: null,
      id_cliente: auditoria.id_cliente,
      id_empresa_auditora: auditoria.id_empresa_auditora,
      id_auditoria: auditoria.id_auditoria,
      tipo_conversacion: 'AUDITORIA',
      id_usuario_cliente: auditoria.id_cliente,
      id_usuario_supervisor: idSupervisor,
      id_usuario_auditor: Number(idAuditor),
      asunto: `Auditoría #${auditoria.id_auditoria}`,
      creado_en: new Date().toISOString(),
      estado: 'ABIERTA',
      activo: true
    });
    return 'created';
  }

  conversaciones[idxConversacion].id_usuario_auditor = Number(idAuditor);
  conversaciones[idxConversacion].id_auditor = Number(idAuditor);
  conversaciones[idxConversacion].id_usuario_supervisor = conversaciones[idxConversacion].id_usuario_supervisor || idSupervisor;
  return 'updated';
}

function limpiarConversacionAuditor(conversaciones, idAuditoria) {
  for (const conversacion of conversaciones) {
    if (isAuditConversation(conversacion) && Number(conversacion.id_auditoria) === Number(idAuditoria)) {
      conversacion.id_usuario_auditor = null;
      conversacion.id_auditor = null;
    }
  }
}

async function guardarAsignacionUnicaAuditor({ idAuditoria, idAuditor, req, reemplazar = false }) {
  const auditorias = await readJson('auditorias.json');
  const participantes = await readJson('auditoria_participantes.json');
  const conversaciones = (await readJson('conversaciones.json')).map(normalizeConversation);
  const auditoria = auditorias.find(a => Number(a.id_auditoria) === Number(idAuditoria));

  if (!auditoria || Number(auditoria.id_empresa_auditora) !== Number(req.user.id_empresa)) {
    const error = new Error('Auditoría inválida o sin permisos');
    error.statusCode = 403;
    throw error;
  }

  const auditor = await cargarAuditorAsignable(idAuditor, req.user.id_empresa);
  if (!auditor) {
    const error = new Error('Auditor no encontrado para esta empresa auditora');
    error.statusCode = 404;
    throw error;
  }

  const actuales = participantes.filter(p => Number(p.id_auditoria) === Number(idAuditoria));
  const yaMismo = actuales.length === 1 && Number(actuales[0].id_auditor) === Number(idAuditor);
  if (yaMismo) {
    const error = new Error('Este auditor ya está asignado.');
    error.statusCode = 400;
    throw error;
  }

  if (actuales.length > 0 && !reemplazar) {
    const error = new Error('La auditoría ya tiene un auditor asignado. Usa Cambiar auditor.');
    error.statusCode = 409;
    throw error;
  }

  const restantes = participantes.filter(p => Number(p.id_auditoria) !== Number(idAuditoria));
  const nuevaAsignacion = {
    id_participante: await getNextId('auditoria_participantes.json', 'id_participante'),
    id_auditoria: Number(idAuditoria),
    id_auditor: Number(idAuditor),
    asignado_en: new Date().toISOString()
  };
  restantes.push(nuevaAsignacion);
  await writeJson('auditoria_participantes.json', restantes);

  const accionConversacion = actualizarConversacionAuditor(conversaciones, auditoria, idAuditor, req.user.id_usuario);
  if (accionConversacion === 'created') {
    const nueva = conversaciones[conversaciones.length - 1];
    nueva.id_conversacion = await getNextId('conversaciones.json', 'id_conversacion');
  }
  await writeJson('conversaciones.json', conversaciones);

  return { auditoria, participante: nuevaAsignacion, auditor };
}

async function quitarAsignacionAuditor({ idAuditoria, req }) {
  const auditorias = await readJson('auditorias.json');
  const participantes = await readJson('auditoria_participantes.json');
  const conversaciones = (await readJson('conversaciones.json')).map(normalizeConversation);
  const auditoria = auditorias.find(a => Number(a.id_auditoria) === Number(idAuditoria));

  if (!auditoria || Number(auditoria.id_empresa_auditora) !== Number(req.user.id_empresa)) {
    const error = new Error('Auditoría inválida o sin permisos');
    error.statusCode = 403;
    throw error;
  }

  const restantes = participantes.filter(p => Number(p.id_auditoria) !== Number(idAuditoria));
  if (restantes.length === participantes.length) {
    const error = new Error('La auditoría no tiene auditor asignado.');
    error.statusCode = 404;
    throw error;
  }

  await writeJson('auditoria_participantes.json', restantes);
  limpiarConversacionAuditor(conversaciones, idAuditoria);
  await writeJson('conversaciones.json', conversaciones);

  return { auditoria };
}

// Gestion de auditorias

// GET /api/supervisor/auditorias/:idEmpresa
router.get('/auditorias/:idEmpresa', authenticate, authorize([1]), async (req, res) => {
  try {
    const idEmpresa = Number(req.params.idEmpresa);
    const idUsuario = req.user.id_usuario;
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const idEstado = req.query.id_estado ? Number(req.query.id_estado) : null;

    if (req.user.id_empresa !== idEmpresa) {
      return res.status(403).json({ message: 'Acceso denegado' });
    }

    const auditorias = await readJson('auditorias.json');
    const usuarios = await readJson('usuarios.json');
    const empresas = await readJson('empresas.json');
    const estados = await readJson('estados_auditoria.json');
    const auditoriaModulos = await readJson('auditoria_modulos.json');

    let all = auditorias.filter(a => a.id_empresa_auditora === idEmpresa);
    
    if (idEstado) {
      all = all.filter(a => a.id_estado === idEstado);
    }

    const auditoriasEnriquecidas = await Promise.all(all.map(async (auditoria) => {
      const datosCliente = await cargarClienteAuditoriaSupervisor(auditoria.id_cliente, usuarios, empresas);
      const estado = estados.find(e => e.id_estado === auditoria.id_estado);
      
      const modulos = modulosUnicosPorAuditoria(auditoriaModulos, auditoria.id_auditoria);

      return {
        ...auditoria,
        modulos,
        fecha_creacion: auditoria.creada_en || auditoria.creado_en,
        monto: auditoria.monto || null,
        cliente: datosCliente.cliente,
        empresa_cliente: datosCliente.empresa,
        estado: estado ? {
          id_estado: estado.id_estado,
          nombre: estado.nombre || estado.clave
        } : null
      };
    }));

    const start = (page - 1) * limit;
    res.json({
      total: auditoriasEnriquecidas.length,
      page,
      limit,
      data: auditoriasEnriquecidas.slice(start, start + limit)
    });
  } catch (error) {
    console.error('Error auditorías:', error);
    res.status(500).json({ message: 'Error interno' });
  }
});

// Actualizar estado de auditoria
router.put('/auditorias/:idAuditoria/estado', authenticate, authorize([1]), async (req, res) => {
  const idAuditoria = Number(req.params.idAuditoria);
  const { id_estado } = req.body;
  
  if (!id_estado) return res.status(400).json({ message: 'Falta id_estado' });

  const auditorias = await readJson('auditorias.json');
  const idx = auditorias.findIndex(a => a.id_auditoria === idAuditoria);
  
  if (idx === -1) return res.status(404).json({ message: 'Auditoría no encontrada' });
  
  if (auditorias[idx].id_empresa_auditora !== req.user.id_empresa) {
    return res.status(403).json({ message: 'No tienes permiso' });
  }

  auditorias[idx].id_estado = Number(id_estado);
  auditorias[idx].estado_actualizado_en = new Date().toISOString();
  await writeJson('auditorias.json', auditorias);
  // Mejora futura: patron Outbox/cola para reintentar sincronizacion con Elasticsearch.
  await updateAuditoria(auditorias[idx]);

  // Notificar al cliente
  try {
    if (auditorias[idx].id_cliente) {
      await crearNotificacion({
        id_cliente: auditorias[idx].id_cliente,
        id_auditoria: idAuditoria,
        tipo: 'estado_cambiado',
        titulo: 'Estado actualizado',
        mensaje: `Tu auditoría #${idAuditoria} cambió de estado.`
      });
    }
  } catch (e) { console.error(e); }

  res.json({ message: 'Estado actualizado', auditoria: auditorias[idx] });
});

// Asignar auditor
router.post('/auditorias/:idAuditoria/asignar', authenticate, authorize([1]), async (req, res) => {
  try {
    const idAuditoria = Number(req.params.idAuditoria);
    const { id_auditor } = req.body;

    if (!Number.isInteger(idAuditoria) || idAuditoria <= 0) return res.status(400).json({ message: 'Auditoría inválida' });
    if (!id_auditor) return res.status(400).json({ message: 'Falta id_auditor' });

    const resultado = await guardarAsignacionUnicaAuditor({ idAuditoria, idAuditor: Number(id_auditor), req, reemplazar: false });
    res.status(201).json({ message: 'Auditor asignado correctamente', ...resultado });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message || 'Error al asignar auditor' });
  }
});

// Cambiar auditor asignado
router.put('/auditorias/:idAuditoria/asignar', authenticate, authorize([1]), async (req, res) => {
  try {
    const idAuditoria = Number(req.params.idAuditoria);
    const { id_auditor } = req.body;

    if (!Number.isInteger(idAuditoria) || idAuditoria <= 0) return res.status(400).json({ message: 'Auditoría inválida' });
    if (!id_auditor) return res.status(400).json({ message: 'Falta id_auditor' });

    const resultado = await guardarAsignacionUnicaAuditor({ idAuditoria, idAuditor: Number(id_auditor), req, reemplazar: true });
    res.json({ message: 'Auditor cambiado correctamente', ...resultado });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message || 'Error al cambiar auditor' });
  }
});

// Quitar auditor asignado
router.delete('/auditorias/:idAuditoria/asignar', authenticate, authorize([1]), async (req, res) => {
  try {
    const idAuditoria = Number(req.params.idAuditoria);
    if (!Number.isInteger(idAuditoria) || idAuditoria <= 0) return res.status(400).json({ message: 'Auditoría inválida' });

    const resultado = await quitarAsignacionAuditor({ idAuditoria, req });
    res.json({ message: 'Auditor removido. La auditoría queda pendiente de asignar auditor.', ...resultado });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message || 'Error al quitar auditor' });
  }
});

// Agregar modulo a auditoria
router.post('/auditorias/:idAuditoria/modulos', authenticate, authorize([1]), async (req, res) => {
  try {
    const idAuditoria = Number(req.params.idAuditoria);
    const moduloInput = req.body.id_modulo ?? req.body.modulo ?? req.body.nombre;
    const idModulo = await resolverIdModulo(moduloInput);

    if (!Number.isInteger(idAuditoria) || idAuditoria <= 0) {
      return res.status(400).json({ message: 'Auditoría inválida' });
    }

    if (!idModulo) {
      return res.status(400).json({ message: 'Módulo no válido' });
    }

    const auditorias = await readJson('auditorias.json');
    const auditoria = auditorias.find(a => Number(a.id_auditoria) === idAuditoria);
    if (!auditoria || Number(auditoria.id_empresa_auditora) !== Number(req.user.id_empresa)) {
      return res.status(403).json({ message: 'Auditoría inválida o sin permisos' });
    }

    const am = await readJson('auditoria_modulos.json');
    const yaExiste = am.some(item =>
      Number(item.id_auditoria) === idAuditoria &&
      Number(item.id_modulo) === idModulo
    );

    if (yaExiste) {
      return res.status(409).json({ message: 'Este módulo ya fue agregado.' });
    }

    const nuevo = {
      id_auditoria_modulo: await getNextId('auditoria_modulos.json', 'id_auditoria_modulo'),
      id_auditoria: idAuditoria,
      id_modulo: idModulo,
      registrado_en: new Date().toISOString()
    };
    
    am.push(nuevo);
    await writeJson('auditoria_modulos.json', am);
    res.status(201).json({ message: 'Módulo agregado', item: nuevo });
  } catch (error) {
    console.error('Error agregando módulo:', error);
    res.status(500).json({ message: 'Error al agregar módulo' });
  }
});

// Obtener participantes
router.get('/auditorias/:idAuditoria/participantes', authenticate, authorize([1]), async (req, res) => {
  const idAuditoria = Number(req.params.idAuditoria);
  const participantes = await readJson('auditoria_participantes.json');

  const vistos = new Set();
  const asignaciones = participantes.filter(p => Number(p.id_auditoria) === idAuditoria && !vistos.has(Number(p.id_auditor)) && vistos.add(Number(p.id_auditor)));
  const resultado = await Promise.all(asignaciones.map(async (a) => {
    const u = await cargarUsuarioPorId(a.id_auditor);
    return { ...(u || { id_usuario: a.id_auditor, nombre: 'Auditor' }), asignado_en: a.asignado_en };
  }));
  res.json(resultado);
});

// Listar clientes con auditorias
router.get('/clientes-con-auditorias', authenticate, authorize([1]), async (req, res) => {
  const idEmpresa = req.user.id_empresa;
  const auditorias = await readJson('auditorias.json');
  const usuarios = await readJson('usuarios.json');
  const empresas = await readJson('empresas.json');

  const misAuditorias = auditorias.filter(a => a.id_empresa_auditora === idEmpresa);
  const idsClientes = [...new Set(misAuditorias.map(a => a.id_cliente))];

  const resultado = [];
  idsClientes.forEach(idC => {
    const user = usuarios.find(u => u.id_usuario === idC);
    if(user && user.id_empresa) {
        const emp = empresas.find(e => e.id_empresa === user.id_empresa);
        if(emp) {
            const existe = resultado.find(r => r.id_empresa === emp.id_empresa);
            if(!existe) {
                resultado.push({
                    ...emp,
                    contacto: user.nombre,
                    total_auditorias: misAuditorias.filter(a => a.id_cliente === idC).length
                });
            }
        }
    }
  });
  res.json(resultado);
});

// Mensajeria y chat

async function cargarClienteConEmpresa(idCliente) {
  const usuarios = await readJson('usuarios.json');
  const empresas = await readJson('empresas.json');

  const usuarioJson = usuarios.find(u => u.id_usuario === Number(idCliente) && u.activo !== false);
  const empresaJson = usuarioJson?.id_empresa
    ? empresas.find(e => e.id_empresa === Number(usuarioJson.id_empresa) && (e.activo !== false && e.activa !== false))
    : null;

  if (usuarioJson && usuarioJson.id_empresa) {
    return {
      id_usuario: usuarioJson.id_usuario,
      id_empresa: Number(usuarioJson.id_empresa),
      nombre: usuarioJson.nombre || 'Usuario',
      nombre_empresa: empresaJson?.nombre || 'Empresa Cliente'
    };
  }

  try {
    const rows = await query(
      `SELECT
        u.id_usuario,
        u.id_empresa,
        u.nombre,
        e.nombre AS nombre_empresa
      FROM usuarios u
      LEFT JOIN empresas e ON e.id_empresa = u.id_empresa
      WHERE u.id_usuario = ?
      LIMIT 1;`,
      [Number(idCliente)]
    );

    const usuarioMysql = rows[0];
    if (usuarioMysql && usuarioMysql.id_empresa) {
      return {
        id_usuario: Number(usuarioMysql.id_usuario),
        id_empresa: Number(usuarioMysql.id_empresa),
        nombre: usuarioMysql.nombre || 'Usuario',
        nombre_empresa: usuarioMysql.nombre_empresa || 'Empresa Cliente'
      };
    }
  } catch (error) {
    console.error('Error consultando MySQL para completar cliente de conversación:', error?.code || error?.message || error);
  }

  return {
    id_usuario: Number(idCliente),
    id_empresa: null,
    nombre: usuarioJson?.nombre || 'Usuario',
    nombre_empresa: empresaJson?.nombre || 'Empresa Cliente'
  };
}

// GET /api/supervisor/conversaciones
// Lista conversaciones de la empresa del supervisor
router.get('/conversaciones', authenticate, authorize([1]), async (req, res) => {
  try {
    const idEmpresa = req.user.id_empresa;
    
    const conversaciones = (await readJson('conversaciones.json')).map(normalizeConversation);
    const mensajes = await readJson('mensajes.json');
    const usuarios = await readJson('usuarios.json');
    const empresas = await readJson('empresas.json');

    // Conversaciones de la empresa
    const misConversaciones = conversaciones.filter(c =>
      isCommercialConversation(c) &&
      c.id_empresa_auditora === idEmpresa &&
      c.activo
    );

    const listaFinal = misConversaciones.map(conv => {
      // Ultimo mensaje
      const msgs = mensajes.filter(m => m.id_conversacion === conv.id_conversacion);
      const ultimoMensaje = msgs.length > 0 ? msgs[msgs.length - 1] : null;

      const clienteUser = usuarios.find(u => u.id_usuario === conv.id_cliente);
      const empresaCliente = clienteUser ? empresas.find(e => e.id_empresa === clienteUser.id_empresa) : null;

      return {
        ...conv,
        id_empresa: conv.id_empresa_auditora,
        id_supervisor: req.user.id_usuario,
        id_auditor: conv.id_auditor || conv.id_usuario_auditor || null,
        nombre_contacto: clienteUser?.nombre || 'Usuario',
        rol_contacto: 'CLIENTE',
        cliente: {
          id_usuario: conv.id_cliente,
          nombre: clienteUser?.nombre || 'Usuario',
          nombre_empresa: empresaCliente?.nombre || 'Empresa Cliente',
          id_empresa: empresaCliente?.id_empresa 
        },
        ultimo_mensaje: ultimoMensaje
      };
    });

    for (const item of listaFinal) {
      if (!item.cliente.id_empresa) {
        const clienteCompleto = await cargarClienteConEmpresa(item.cliente.id_usuario);
        item.cliente = {
          ...item.cliente,
          ...clienteCompleto
        };
        item.nombre_contacto = clienteCompleto.nombre;
      }
    }

    listaFinal.sort((a, b) => {
      const fechaA = a.ultimo_mensaje ? new Date(a.ultimo_mensaje.creado_en) : new Date(a.creado_en);
      const fechaB = b.ultimo_mensaje ? new Date(b.ultimo_mensaje.creado_en) : new Date(b.creado_en);
      return fechaB - fechaA;
    });

    res.json(listaFinal);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error cargando conversaciones' });
  }
});

// GET /api/supervisor/mensajes/:idConversacion
router.get('/mensajes/:idConversacion', authenticate, authorize([1]), async (req, res) => {
  const idConversacion = Number(req.params.idConversacion);
  const mensajes = await readJson('mensajes.json');
  const conversaciones = (await readJson('conversaciones.json')).map(normalizeConversation);

  const conversacion = conversaciones.find(c => c.id_conversacion === idConversacion && c.activo);
  if (!conversacion || !isCommercialConversation(conversacion) || conversacion.id_empresa_auditora !== req.user.id_empresa) {
    return res.status(403).json({ message: 'No tienes permiso' });
  }
  
  const historial = mensajes.filter(m => m.id_conversacion === idConversacion);
  historial.sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en));

  res.json(historial);
});

// POST /api/supervisor/mensajes
router.post('/mensajes', authenticate, authorize([1]), async (req, res) => {
  try {
    const { id_conversacion, contenido } = req.body;
    const idUsuario = req.user.id_usuario;
    
    if (!id_conversacion || !contenido) return res.status(400).json({ message: 'Faltan datos' });

    const mensajes = await readJson('mensajes.json');
    const conversaciones = (await readJson('conversaciones.json')).map(normalizeConversation);
    const usuarios = await readJson('usuarios.json');
    const empresas = await readJson('empresas.json');

    const idxConv = conversaciones.findIndex(c => c.id_conversacion === Number(id_conversacion) && c.activo);
    if (idxConv === -1 || !isCommercialConversation(conversaciones[idxConv]) || conversaciones[idxConv].id_empresa_auditora !== req.user.id_empresa) {
      return res.status(403).json({ message: 'Conversación no válida' });
    }

    if (!conversaciones[idxConv].id_supervisor) {
      conversaciones[idxConv].id_supervisor = idUsuario;
      conversaciones[idxConv].id_usuario_supervisor = idUsuario;
    }

    const idMensaje = await getNextId('mensajes.json', 'id_mensaje');
    const nuevoMensaje = {
      id_mensaje: idMensaje,
      id_conversacion: Number(id_conversacion),
      emisor_tipo: 'SUPERVISOR',
      emisor_id: idUsuario,
      contenido: contenido,
      creado_en: new Date().toISOString()
    };

    mensajes.push(nuevoMensaje);
    await writeJson('mensajes.json', mensajes);

    conversaciones[idxConv].ultimo_mensaje_fecha = nuevoMensaje.creado_en;
    await writeJson('conversaciones.json', conversaciones);

    // Notificar cliente
    try {
      const empresa = empresas.find(e => e.id_empresa === conversaciones[idxConv].id_empresa_auditora);
      const nombreEmpresa = empresa ? empresa.nombre : 'Empresa auditora';
      await crearNotificacion({
        id_cliente: conversaciones[idxConv].id_cliente,
        id_auditoria: null,
        tipo: 'mensaje_nuevo',
        titulo: 'Nuevo mensaje',
        mensaje: `Tienes un nuevo mensaje de ${nombreEmpresa}`
      });
    } catch (e) { console.error(e); }

    res.status(201).json(nuevoMensaje);
  } catch (error) {
    console.error('Error al enviar mensaje:', error);
    res.status(500).json({ message: 'Error al enviar mensaje' });
  }
});

// Reportes y evidencias

router.get('/auditorias/:id/reporte-final', authenticate, authorize([1]), async (req, res) => {
  const idAuditoria = Number(req.params.id);
  const reportes = await readJson('reportes.json');
  
  // Se puede validar id_empresa_auditora aqui
  const reporte = reportes.find(r => r.id_auditoria === idAuditoria && r.tipo === 'FINAL');
  if(!reporte) return res.status(404).json({ message: 'No existe reporte final' });
  
  res.json(reporte);
});

router.get('/auditorias/:idAuditoria/evidencias', authenticate, authorize([1]), async (req, res) => {
  const idAuditoria = Number(req.params.idAuditoria);
  const evidencias = await readJson('evidencias.json');
  res.json(evidencias.filter(e => e.id_auditoria === idAuditoria));
});

// GET /api/supervisor/empresas-clientes
// Lista empresas cliente (tipo 2)
router.get('/empresas-clientes', authenticate, authorize([1]), async (req, res) => {
  try {
    const empresas = await readJson('empresas.json');
    // Solo clientes activos
    const clientes = empresas.filter(e => e.id_tipo_empresa === 2 && e.activo);
    
    res.json(clientes.map(c => ({
      id_empresa: c.id_empresa,
      nombre: c.nombre
    })));
  } catch (error) {
    res.status(500).json({ message: 'Error cargando empresas' });
  }
});

// GET /api/supervisor/usuarios-empresa/:idEmpresa
// Lista contactos de una empresa
router.get('/usuarios-empresa/:idEmpresa', authenticate, authorize([1]), async (req, res) => {
  try {
    const idEmpresa = Number(req.params.idEmpresa);
    const usuarios = await readJson('usuarios.json');
    
    // Usuarios cliente activos de la empresa
    const contactos = usuarios.filter(u => u.id_empresa === idEmpresa && u.id_rol === 3 && u.activo);
    
    res.json(contactos.map(u => ({
      id_usuario: u.id_usuario,
      nombre: u.nombre,
      correo: u.correo
    })));
  } catch (error) {
    res.status(500).json({ message: 'Error cargando usuarios' });
  }
});

module.exports = router;