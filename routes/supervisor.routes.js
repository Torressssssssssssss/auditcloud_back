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
  const usuarios = await readJson('usuarios.json');

  if (req.user.id_empresa !== idEmpresa) {
      return res.status(403).json({ message: 'No tienes permiso para ver auditores de otra empresa.' });
  }

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

    const auditoriasEnriquecidas = all.map(auditoria => {
      const cliente = usuarios.find(u => u.id_usuario === auditoria.id_cliente);
      const empresaCliente = empresas.find(e => e.id_empresa === cliente?.id_empresa);
      const estado = estados.find(e => e.id_estado === auditoria.id_estado);
      
      const modulos = auditoriaModulos
        .filter(am => am.id_auditoria === auditoria.id_auditoria)
        .map(am => am.id_modulo);

      return {
        ...auditoria,
        modulos,
        fecha_creacion: auditoria.creada_en || auditoria.creado_en,
        monto: auditoria.monto || null,
        cliente: cliente ? {
          id_usuario: cliente.id_usuario,
          nombre: cliente.nombre,
          correo: cliente.correo
        } : null,
        empresa_cliente: empresaCliente ? {
          id_empresa: empresaCliente.id_empresa,
          nombre: empresaCliente.nombre
        } : null,
        estado: estado ? {
          id_estado: estado.id_estado,
          nombre: estado.nombre || estado.clave
        } : null
      };
    });

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
  const idAuditoria = Number(req.params.idAuditoria);
  const { id_auditor } = req.body;

  if (!id_auditor) return res.status(400).json({ message: 'Falta id_auditor' });

  const participantes = await readJson('auditoria_participantes.json');
  const auditorias = await readJson('auditorias.json');
  const conversaciones = (await readJson('conversaciones.json')).map(normalizeConversation);
  
  const auditoria = auditorias.find(a => a.id_auditoria === idAuditoria);
  if (!auditoria || auditoria.id_empresa_auditora !== req.user.id_empresa) {
    return res.status(403).json({ message: 'Auditoría inválida o sin permisos' });
  }

  const yaAsignado = participantes.some(p => p.id_auditoria === idAuditoria && p.id_auditor === Number(id_auditor));
  if (yaAsignado) return res.status(400).json({ message: 'Auditor ya asignado' });

  const nuevo = {
    id_participante: await getNextId('auditoria_participantes.json', 'id_participante'),
    id_auditoria: idAuditoria,
    id_auditor: Number(id_auditor),
    asignado_en: new Date().toISOString()
  };
  
  participantes.push(nuevo);
  await writeJson('auditoria_participantes.json', participantes);

  const idxConversacion = conversaciones.findIndex(c =>
    isAuditConversation(c) &&
    c.id_auditoria === idAuditoria &&
    c.id_cliente === auditoria.id_cliente &&
    c.id_empresa_auditora === auditoria.id_empresa_auditora &&
    c.activo
  );

  if (idxConversacion === -1) {
    const nuevaConversacion = {
      id_conversacion: await getNextId('conversaciones.json', 'id_conversacion'),
      id_cliente: auditoria.id_cliente,
      id_empresa_auditora: auditoria.id_empresa_auditora,
      id_auditoria: idAuditoria,
      tipo_conversacion: 'AUDITORIA',
      id_usuario_cliente: auditoria.id_cliente,
      id_usuario_supervisor: req.user.id_usuario,
      id_usuario_auditor: Number(id_auditor),
      asunto: `Auditoría #${idAuditoria}`,
      creado_en: new Date().toISOString(),
      estado: 'ABIERTA',
      activo: true
    };

    conversaciones.push(nuevaConversacion);
    await writeJson('conversaciones.json', conversaciones);
  } else {
    conversaciones[idxConversacion].id_usuario_auditor = Number(id_auditor);
    conversaciones[idxConversacion].id_auditor = Number(id_auditor);
    conversaciones[idxConversacion].id_usuario_supervisor = conversaciones[idxConversacion].id_usuario_supervisor || req.user.id_usuario;
    await writeJson('conversaciones.json', conversaciones);
  }
  res.status(201).json({ message: 'Asignado correctamente', participante: nuevo });
});

// Agregar modulo a auditoria
router.post('/auditorias/:idAuditoria/modulos', authenticate, authorize([1]), async (req, res) => {
  const idAuditoria = Number(req.params.idAuditoria);
  const { id_modulo } = req.body;

  const am = await readJson('auditoria_modulos.json');
  
  const nuevo = {
    id_auditoria_modulo: await getNextId('auditoria_modulos.json', 'id_auditoria_modulo'),
    id_auditoria: idAuditoria,
    id_modulo: Number(id_modulo),
    registrado_en: new Date().toISOString()
  };
  
  am.push(nuevo);
  await writeJson('auditoria_modulos.json', am);
  res.status(201).json({ message: 'Módulo agregado', item: nuevo });
});

// Obtener participantes
router.get('/auditorias/:idAuditoria/participantes', authenticate, authorize([1]), async (req, res) => {
  const idAuditoria = Number(req.params.idAuditoria);
  const participantes = await readJson('auditoria_participantes.json');
  const usuarios = await readJson('usuarios.json');

  const asignaciones = participantes.filter(p => p.id_auditoria === idAuditoria);
  const resultado = asignaciones.map(a => {
    const u = usuarios.find(user => user.id_usuario === a.id_auditor);
    return { ...u, asignado_en: a.asignado_en };
  });
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