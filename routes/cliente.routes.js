// Rutas de cliente: registro, conversaciones, mensajes y acciones del cliente.
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { query } = require('../utils/db');
const { readJson, writeJson, getNextId, crearNotificacion } = require('../utils/jsonDb');
const { authenticate, authorize, signToken } = require('../utils/auth');
const { normalizeConversation, isCommercialConversation, isAuditConversation } = require('../utils/conversationContext');

// POST /api/cliente/registro
// Registro de nuevo cliente (no requiere autenticación)
router.post('/registro', async (req, res) => {
  try {
    const { nombre, correo, password, nombre_empresa, ciudad, estado, rfc } = req.body;

    // Validar campos requeridos
    if (!nombre || !correo || !password || !nombre_empresa) {
      return res.status(400).json({ 
        message: 'nombre, correo, password y nombre_empresa son obligatorios' 
      });
    }

    const usuarios = await readJson('usuarios.json');
    const empresas = await readJson('empresas.json');

    // Validar correo unico
    const correoExistente = usuarios.find(u => u.correo === correo && u.activo);
    if (correoExistente) {
      return res.status(400).json({
        message: 'El correo ya está registrado'
      });
    }

    // Crear empresa cliente
    const idEmpresa = await getNextId('empresas.json', 'id_empresa');
    const nuevaEmpresa = {
      id_empresa: idEmpresa,
      id_tipo_empresa: 2, // Tipo CLIENTE
      nombre: nombre_empresa,
      rfc: rfc || null,
      giro: null,
      direccion: null,
      ciudad: ciudad || null,
      estado: estado || null,
      pais: 'México',
      contacto_nombre: nombre,
      contacto_correo: correo,
      contacto_telefono: null,
      activo: true
    };
    empresas.push(nuevaEmpresa);
    await writeJson('empresas.json', empresas);

    // Crear usuario cliente
    const idUsuario = await getNextId('usuarios.json', 'id_usuario');
    const nuevoUsuario = {
      id_usuario: idUsuario,
      id_empresa: idEmpresa,
      nombre: nombre,
      correo: correo,
      password_hash: password,
      id_rol: 3, // Rol de cliente
      activo: true,
      creado_en: new Date().toISOString()
    };
    usuarios.push(nuevoUsuario);
    await writeJson('usuarios.json', usuarios);
    // Generar token
    const token = signToken(nuevoUsuario);

    // Respuesta para frontend
    res.status(201).json({
      token: token,
      usuario: {
        id_usuario: nuevoUsuario.id_usuario,
        id_rol: nuevoUsuario.id_rol,
        id_empresa: nuevoUsuario.id_empresa,
        nombre: nuevoUsuario.nombre,
        correo: nuevoUsuario.correo
      }
    });
  } catch (error) {
    console.error('Error en registro de cliente:', error);
    res.status(500).json({ 
      message: error.message || 'No se pudo registrar.' 
    });
  }
});

// GET /api/auditor/conversaciones
// Obtiene conversaciones de clientes ASIGNADOS a este auditor
router.get('/conversaciones', authenticate, authorize([2]), async (req, res) => {
  try {
    const idAuditor = req.user.id_usuario;
    const idEmpresa = req.user.id_empresa;

    const conversaciones = (await readJson('conversaciones.json')).map(normalizeConversation);
    const mensajes = await readJson('mensajes.json');
    const usuarios = await readJson('usuarios.json');
    
    // Datos para validar permisos
    const participantes = await readJson('auditoria_participantes.json');
    const auditorias = await readJson('auditorias.json');

    // IDs de auditorias del auditor
    const misAuditoriasIds = participantes
      .filter(p => p.id_auditor === idAuditor)
      .map(p => p.id_auditoria);

    // IDs de clientes asignados
    const misClientesIds = auditorias
      .filter(a => misAuditoriasIds.includes(a.id_auditoria))
      .map(a => a.id_cliente);

    // Conversaciones de su empresa y clientes asignados
    const misConversaciones = conversaciones.filter(c => 
      isAuditConversation(c) &&
      c.id_empresa_auditora === idEmpresa && 
      c.activo &&
      misClientesIds.includes(c.id_cliente) &&
      (!c.id_auditoria || misAuditoriasIds.includes(c.id_auditoria))
    );

    // Enriquecer respuesta
    const listaFinal = misConversaciones.map(conv => {
      const msgs = mensajes.filter(m => m.id_conversacion === conv.id_conversacion);
      const ultimoMensaje = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      
      const clienteUser = usuarios.find(u => u.id_usuario === conv.id_cliente);

      return {
        ...conv,
        id_empresa: conv.id_empresa_auditora,
        id_supervisor: conv.id_supervisor || conv.id_usuario_supervisor || null,
        id_auditor: conv.id_auditor || conv.id_usuario_auditor || req.user.id_usuario,
        nombre_contacto: clienteUser?.nombre || 'Cliente',
        rol_contacto: 'CLIENTE',
        cliente: {
          id_usuario: conv.id_cliente,
          nombre: clienteUser?.nombre || 'Cliente'
        },
        ultimo_mensaje: ultimoMensaje
      };
    });

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


// GET /api/cliente/mensajes/:idConversacion
// Carga el historial de un chat específico
router.get('/mensajes/:idConversacion', authenticate, authorize([3]), async (req, res) => {
  const idConversacion = Number(req.params.idConversacion);
  const mensajes = await readJson('mensajes.json');
  const conversaciones = (await readJson('conversaciones.json')).map(normalizeConversation);
  const participantes = await readJson('auditoria_participantes.json');
  const auditorias = await readJson('auditorias.json');
  const usuarios = await readJson('usuarios.json');
  
  const conversacion = conversaciones.find(c => c.id_conversacion === idConversacion && c.activo);
  if (!conversacion || conversacion.id_cliente !== req.user.id_usuario) {
    return res.status(403).json({ message: 'No tienes permiso' });
  }

  if (isAuditConversation(conversacion) && conversacion.id_auditoria) {
    const auditoria = auditorias.find(a => a.id_auditoria === conversacion.id_auditoria);
    const asignacion = participantes.find(p => p.id_auditoria === auditoria?.id_auditoria);
    const auditor = asignacion ? usuarios.find(u => u.id_usuario === asignacion.id_auditor) : null;
    if (!asignacion || !auditor) {
      return res.status(404).json({ message: 'Chat de auditoría no disponible todavía' });
    }
  }
  
  // Filtrar mensajes de la conversacion
  const historial = mensajes.filter(m => m.id_conversacion === idConversacion);
  
  // Orden cronologico ascendente
  historial.sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en));

  res.json(historial);
});


// POST /api/cliente/mensajes
router.post('/mensajes', authenticate, authorize([3]), async (req, res) => {
  try {
    const { id_empresa_auditora, id_conversacion, contenido } = req.body;
    const idUsuario = req.user.id_usuario;

    if (!contenido) return res.status(400).json({ message: 'Contenido obligatorio' });

    const conversaciones = (await readJson('conversaciones.json')).map(normalizeConversation);
    const mensajes = await readJson('mensajes.json');

    let conversacionId = id_conversacion;

    // Si no hay conversacion, crearla
    if (!conversacionId) {
      if (!id_empresa_auditora) return res.status(400).json({ message: 'Falta id_empresa_auditora' });

      // Evitar duplicados
      const existe = conversaciones.find(c => 
        isCommercialConversation(c) &&
        c.id_cliente === idUsuario && 
        c.id_empresa_auditora === Number(id_empresa_auditora) &&
        c.activo
      );

      if (existe) {
        conversacionId = existe.id_conversacion;
      } else {
        // Crear conversacion
        conversacionId = await getNextId('conversaciones.json', 'id_conversacion');
        const nueva = {
          id_conversacion: conversacionId,
          id_cliente: idUsuario,
          id_empresa_auditora: Number(id_empresa_auditora),
          tipo_conversacion: 'COMERCIAL',
          id_auditoria: null,
          id_usuario_cliente: idUsuario,
          id_usuario_supervisor: null,
          id_usuario_auditor: null,
          asunto: 'Consulta General',
          creado_en: new Date().toISOString(),
          estado: 'ABIERTA',
          activo: true
        };
        conversaciones.push(nueva);
        await writeJson('conversaciones.json', conversaciones);
      }
    }

    const conversacionActual = conversaciones.find(c => c.id_conversacion === Number(conversacionId) && c.activo);
    if (!conversacionActual || conversacionActual.id_cliente !== idUsuario) {
      return res.status(403).json({ message: 'No tienes permisos para enviar mensajes en esta conversación' });
    }

    // Crear mensaje
    const idMensaje = await getNextId('mensajes.json', 'id_mensaje');
    const nuevoMensaje = {
      id_mensaje: idMensaje,
      id_conversacion: Number(conversacionId),
      emisor_tipo: 'CLIENTE',
      emisor_id: idUsuario,
      contenido: contenido,
      creado_en: new Date().toISOString()
    };

    mensajes.push(nuevoMensaje);
    
    // Actualizar fecha del ultimo mensaje
    const idx = conversaciones.findIndex(c => c.id_conversacion === Number(conversacionId));
    if(idx !== -1) {
        conversaciones[idx].ultimo_mensaje_fecha = nuevoMensaje.creado_en;
        await writeJson('conversaciones.json', conversaciones);
    }
    
    await writeJson('mensajes.json', mensajes);

    res.status(201).json(nuevoMensaje);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error interno' });
  }
});


// POST /api/cliente/conversaciones
// Crea una conversación nueva entre cliente y empresa auditora
router.post('/conversaciones', authenticate, authorize([3]), async (req, res) => {
  const { id_cliente, id_empresa_auditora, asunto, primer_mensaje } = req.body;
  if (!id_cliente || !id_empresa_auditora || !asunto || !primer_mensaje) {
    return res.status(400).json({ message: 'id_cliente, id_empresa_auditora, asunto y primer_mensaje son obligatorios' });
  }

  const conversaciones = (await readJson('conversaciones.json')).map(normalizeConversation);
  const mensajes = await readJson('mensajes.json');
  const empresas = await readJson('empresas.json');
  const empresaValida = empresas.some(e => e.id_empresa === Number(id_empresa_auditora) && (e.activo ?? e.activa));
  if (!empresaValida) return res.status(404).json({ message: 'Empresa auditora no encontrada o inactiva' });

  if (Number(id_cliente) !== req.user.id_usuario) {
    return res.status(403).json({ message: 'No tienes permisos para crear una conversación para otro cliente' });
  }

  const existente = conversaciones.find(c => 
    isCommercialConversation(c) &&
    c.id_cliente === Number(id_cliente) && 
    c.id_empresa_auditora === Number(id_empresa_auditora) &&
    c.activo
  );

  if (existente) {
    const idMensaje = await getNextId('mensajes.json', 'id_mensaje');
    const mensajeInicial = {
      id_mensaje: idMensaje,
      id_conversacion: existente.id_conversacion,
      emisor_tipo: 'CLIENTE',
      emisor_id: Number(id_cliente),
      contenido: primer_mensaje,
      creado_en: new Date().toISOString()
    };
    mensajes.push(mensajeInicial);
    await writeJson('mensajes.json', mensajes);

    return res.status(201).json({
      message: 'Conversación creada',
      conversacion: existente,
      primer_mensaje: mensajeInicial
    });
  }

  const idConversacion = await getNextId('conversaciones.json', 'id_conversacion');
  const nueva = {
    id_conversacion: idConversacion,
    id_cliente: Number(id_cliente),
    id_empresa_auditora: Number(id_empresa_auditora),
    tipo_conversacion: 'COMERCIAL',
    id_auditoria: null,
    id_usuario_cliente: Number(id_cliente),
    id_usuario_supervisor: null,
    id_usuario_auditor: null,
    asunto,
    creado_en: new Date().toISOString(),
    estado: 'ABIERTA',
    activo: true
  };

  conversaciones.push(nueva);
  await writeJson('conversaciones.json', conversaciones);

  const idMensaje = await getNextId('mensajes.json', 'id_mensaje');
  const mensajeInicial = {
    id_mensaje: idMensaje,
    id_conversacion: idConversacion,
    emisor_tipo: 'CLIENTE',
    emisor_id: Number(id_cliente),
    contenido: primer_mensaje,
    creado_en: new Date().toISOString()
  };
  mensajes.push(mensajeInicial);
  await writeJson('mensajes.json', mensajes);

  res.status(201).json({
    message: 'Conversación creada',
    conversacion: nueva,
    primer_mensaje: mensajeInicial
  });
});


// GET /api/cliente/conversaciones/:idCliente
router.get('/conversaciones/:idCliente', authenticate, authorize([3]), async (req, res) => {
  try {
    const idCliente = Number(req.params.idCliente);
    
    const conversaciones = (await readJson('conversaciones.json')).map(normalizeConversation);
    const mensajes = await readJson('mensajes.json');
    const empresas = await readJson('empresas.json');
    const usuarios = await readJson('usuarios.json');
    const auditorias = await readJson('auditorias.json');
    const participantes = await readJson('auditoria_participantes.json');

    // Filtrar conversaciones de este cliente
    const misConversaciones = conversaciones.filter(c => c.id_cliente === idCliente && c.activo);

    const listaFinal = misConversaciones.map(conv => {
      const msgsDeChat = mensajes.filter(m => m.id_conversacion === conv.id_conversacion);
      const ultimoMensaje = msgsDeChat.length > 0 ? msgsDeChat[msgsDeChat.length - 1] : null;
      const empresa = empresas.find(e => e.id_empresa === conv.id_empresa_auditora);
      const auditoria = conv.id_auditoria ? auditorias.find(a => a.id_auditoria === conv.id_auditoria) : null;
      const asignacion = auditoria ? participantes.find(p => p.id_auditoria === auditoria.id_auditoria) : null;
      const auditor = asignacion ? usuarios.find(u => u.id_usuario === asignacion.id_auditor) : null;
      const esAudit = isAuditConversation(conv);

      return {
        ...conv,
        id_empresa: conv.id_empresa_auditora,
        id_supervisor: conv.id_supervisor || conv.id_usuario_supervisor || null,
        id_auditor: conv.id_auditor || conv.id_usuario_auditor || auditor?.id_usuario || null,
        nombre_contacto: esAudit
          ? auditor?.nombre || 'Auditor asignado'
          : empresa?.contacto_nombre || empresa?.nombre || 'Supervisor',
        rol_contacto: esAudit ? 'AUDITOR' : 'SUPERVISOR',
        empresa: {
          id_empresa: empresa?.id_empresa,
          nombre: empresa?.nombre
        },
        ultimo_mensaje: ultimoMensaje
      };
    });

    res.json(listaFinal); // Devuelve [] si no hay datos, NO devuelve 404
  } catch (error) {
    res.status(500).json({ message: 'Error interno' });
  }
});

router.get('/auditorias/:idCliente', authenticate, authorize([3]), async (req, res) => {
  try {
    const idCliente = Number(req.params.idCliente);
    
    // Leemos todas las tablas necesarias
    const auditorias = await readJson('auditorias.json');
    const empresas = await readJson('empresas.json');
    const auditoriaModulos = await readJson('auditoria_modulos.json');
    
    // 1. Filtrar auditorías de este cliente
    const misAuditorias = auditorias.filter(a => a.id_cliente === idCliente);

    // 2. Enriquecer los datos
    const resultado = misAuditorias.map(audit => {
      // Buscar nombre de la empresa auditora
      const empresa = empresas.find(e => e.id_empresa === audit.id_empresa_auditora);
      
      // Buscar módulos asignados (Array de IDs)
      const modulosIds = auditoriaModulos
        .filter(am => am.id_auditoria === audit.id_auditoria)
        .map(am => am.id_modulo);

      return {
        id_auditoria: audit.id_auditoria,
        id_estado: audit.id_estado, // 1: Creada, 2: En Proceso, 3: Finalizada
        fecha_creacion: audit.creada_en || audit.fecha_creacion,
        
        // Objeto empresa para que funcione el HTML {{ auditoria.empresa?.nombre }}
        empresa: {
          id_empresa: empresa?.id_empresa,
          nombre: empresa?.nombre || 'Empresa Desconocida'
        },
        
        // Array de módulos para que funcione getModulosTexto()
        modulos: modulosIds 
      };
    });

    // Ordenar: Más recientes primero
    resultado.sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));

    res.json(resultado); // Enviamos el array directo (sin paginación compleja por ahora)

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error cargando auditorías' });
  }
});

// --- Solicitudes de pago del cliente ---
// GET /api/cliente/solicitudes-pago/:idCliente
router.get('/solicitudes-pago/:idCliente', authenticate, authorize([3]), async (req, res) => {
  const idCliente = Number(req.params.idCliente);
  const solicitudes = await readJson('solicitudes_pago.json');
  res.json(solicitudes.filter(s => s.id_cliente === idCliente));
});
// POST /api/auditor/solicitudes-pago
// El AUDITOR (Rol 2) genera una solicitud de cobro para un cliente
router.post('/solicitudes-pago', authenticate, authorize([2]), async (req, res) => {
  const { id_cliente, monto, concepto } = req.body;
  
  // El ID de la empresa sale del usuario auditor logueado (req.user)
  // No necesitamos pedirlo en el body por seguridad
  const id_empresa_auditora = req.user.id_empresa;

  if (!id_cliente || !monto || !concepto) {
    return res.status(400).json({ message: 'id_cliente, monto y concepto son obligatorios' });
  }

  const solicitudes = await readJson('solicitudes_pago.json');
  const usuarios = await readJson('usuarios.json');

  // Validar que el cliente exista
  const clienteValido = usuarios.some(u => u.id_usuario === Number(id_cliente) && u.id_rol === 3 && u.activo);
  if (!clienteValido) return res.status(404).json({ message: 'Cliente no encontrado o inactivo' });

  const idSolicitud = await getNextId('solicitudes_pago.json', 'id_solicitud');
  
  const nueva = {
    id_solicitud: idSolicitud,
    id_empresa: Number(id_empresa_auditora),
    id_empresa_auditora: Number(id_empresa_auditora),
    id_cliente: Number(id_cliente),
    monto: Number(monto),
    concepto,
    id_estado: 1, // 1 = PENDIENTE DE PAGO
    creado_en: new Date().toISOString(),
    creado_por_auditor: req.user.id_usuario // Auditoría interna: saber quién cobró
  };

  solicitudes.push(nueva);
  await writeJson('solicitudes_pago.json', solicitudes);

  res.status(201).json({ message: 'Solicitud de cobro creada', solicitud: nueva });
});

// GET /api/cliente/empresas-auditoras
// Lista empresas auditoras activas desde MySQL.
router.get('/empresas-auditoras', authenticate, authorize([3]), async (req, res) => {
  try {
    const rows = await query(
      `SELECT
        e.id_empresa,
        e.nombre,
        e.tipo_auditoria,
        e.rfc,
        e.giro,
        e.direccion,
        e.ciudad,
        e.estado,
        e.pais,
        e.contacto_nombre,
        e.contacto_correo,
        e.contacto_telefono,
        e.activo,
        em.id_modulo,
        m.nombre AS modulo_nombre,
        m.clave AS modulo_clave
      FROM empresas e
      LEFT JOIN empresa_modulos em ON em.id_empresa = e.id_empresa
      LEFT JOIN modulos_ambientales m ON m.id_modulo = em.id_modulo
      WHERE e.id_tipo_empresa = 1
        AND e.activo = 1
      ORDER BY e.id_empresa, em.id_modulo;`
    );

    const empresasMap = new Map();

    for (const row of rows) {
      if (!empresasMap.has(row.id_empresa)) {
        empresasMap.set(row.id_empresa, {
          id_empresa: row.id_empresa,
          nombre: row.nombre,
          tipo_auditoria: row.tipo_auditoria,
          rfc: row.rfc || null,
          giro: row.giro || null,
          direccion: row.direccion || null,
          ciudad: row.ciudad || null,
          estado: row.estado || null,
          pais: row.pais || null,
          contacto_nombre: row.contacto_nombre || null,
          contacto_correo: row.contacto_correo || null,
          contacto_telefono: row.contacto_telefono || null,
          activo: row.activo,
          modulos: []
        });
      }

      if (row.id_modulo !== null && row.id_modulo !== undefined) {
        const empresa = empresasMap.get(row.id_empresa);
        empresa.modulos.push({
          id_modulo: row.id_modulo,
          nombre: row.modulo_nombre,
          clave: row.modulo_clave
        });
      }
    }

    res.json(Array.from(empresasMap.values()));
  } catch (error) {
    console.error('Error al obtener empresas auditoras:', error);
    res.status(500).json({ message: error.message || 'Error al obtener empresas auditoras' });
  }
});

// GET /api/cliente/empresas-auditoras/:id
// Obtener detalle de una empresa auditora específica
router.get('/empresas-auditoras/:id', authenticate, authorize([3]), async (req, res) => {
  try {
    const idEmpresa = Number(req.params.id);
    const empresas = await readJson('empresas.json');
    const empresaModulos = await readJson('empresa_modulos.json');
    const modulosAmbientales = await readJson('modulos_ambientales.json');

    const empresa = empresas.find(e => e.id_empresa === idEmpresa && e.id_tipo_empresa === 1 && (e.activo ?? e.activa));
    if (!empresa) {
      return res.status(404).json({ message: 'Empresa auditora no encontrada' });
    }

    // Obtener módulos de la empresa
    const modulosIds = empresaModulos
      .filter(em => em.id_empresa === idEmpresa)
      .map(em => em.id_modulo);

    const modulos = modulosIds.map(id => {
      const modulo = modulosAmbientales.find(m => m.id_modulo === id);
      return modulo ? { id_modulo: modulo.id_modulo, nombre: modulo.nombre, clave: modulo.clave } : null;
    }).filter(m => m !== null);

    res.json({
      id_empresa: empresa.id_empresa,
      nombre: empresa.nombre,
      rfc: empresa.rfc || null,
      direccion: empresa.direccion || null,
      telefono: empresa.contacto_telefono || null,
      pais: empresa.pais || null,
      estado: empresa.estado || null,
      ciudad: empresa.ciudad || null,
      modulos: modulosIds,
      modulos_detalle: modulos,
      descripcion: empresa.giro || null
    });
  } catch (error) {
    console.error('Error al obtener detalle de empresa:', error);
    res.status(500).json({ message: error.message || 'Error al obtener detalle de empresa' });
  }
});

// GET /api/cliente/mensajes/:idConversacion
// Obtener mensajes de una conversación específica
router.get('/mensajes/:idConversacion', authenticate, authorize([3]), async (req, res) => {
  try {
    const idConversacion = Number(req.params.idConversacion);
    const idUsuario = req.user.id_usuario;

    const conversaciones = await readJson('conversaciones.json');
    const mensajes = await readJson('mensajes.json');

    const conversacion = conversaciones.find(c => c.id_conversacion === idConversacion && c.activo);
    if (!conversacion) {
      return res.status(404).json({ message: 'Conversación no encontrada' });
    }

    // Verificar que el cliente pertenece a esta conversación
    if (conversacion.id_cliente !== idUsuario) {
      return res.status(403).json({ message: 'No tienes permisos para ver esta conversación' });
    }

    const mensajesConversacion = mensajes
      .filter(m => m.id_conversacion === idConversacion)
      .sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en));

    res.json({
      id_conversacion: conversacion.id_conversacion,
      id_cliente: conversacion.id_cliente,
      id_empresa_auditora: conversacion.id_empresa_auditora,
      asunto: conversacion.asunto,
      creado_en: conversacion.creado_en,
      mensajes: mensajesConversacion.map(m => ({
        id_mensaje: m.id_mensaje,
        id_remitente: m.emisor_id,
        tipo_remitente: m.emisor_tipo,
        contenido: m.contenido,
        fecha_envio: m.creado_en
      }))
    });
  } catch (error) {
    console.error('Error al obtener mensajes:', error);
    res.status(500).json({ message: error.message || 'Error al obtener mensajes' });
  }
});

// POST /api/cliente/mensajes
// Enviar un mensaje (crear conversación o responder)
router.post('/mensajes', authenticate, authorize([3]), async (req, res) => {
  try {
    const { id_empresa_auditora, id_conversacion, contenido } = req.body;
    const idUsuario = req.user.id_usuario;

    if (!contenido) {
      return res.status(400).json({ message: 'contenido es obligatorio' });
    }

    const conversaciones = await readJson('conversaciones.json');
    const mensajes = await readJson('mensajes.json');
    const empresas = await readJson('empresas.json');
    const usuarios = await readJson('usuarios.json');

    let conversacionId = id_conversacion;

    // Si no hay id_conversacion, crear una nueva conversación
    if (!conversacionId) {
      if (!id_empresa_auditora) {
        return res.status(400).json({ message: 'id_empresa_auditora es obligatorio si no hay id_conversacion' });
      }

      const empresaValida = empresas.find(e => e.id_empresa === Number(id_empresa_auditora) && (e.activo ?? e.activa));
      if (!empresaValida) {
        return res.status(404).json({ message: 'Empresa auditora no encontrada o inactiva' });
      }

      const cliente = usuarios.find(u => u.id_usuario === idUsuario && u.id_rol === 3 && u.activo);
      if (!cliente) {
        return res.status(404).json({ message: 'Cliente no encontrado o inactivo' });
      }

      conversacionId = await getNextId('conversaciones.json', 'id_conversacion');
      const nuevaConversacion = {
        id_conversacion: conversacionId,
        id_cliente: idUsuario,
        id_empresa_auditora: Number(id_empresa_auditora),
        asunto: contenido.substring(0, 100) || 'Nueva conversación',
        creado_en: new Date().toISOString(),
        activo: true
      };
      conversaciones.push(nuevaConversacion);
      await writeJson('conversaciones.json', conversaciones);
    } else {
      // Verificar que la conversación existe y pertenece al cliente
      const conversacion = conversaciones.find(c => c.id_conversacion === Number(conversacionId) && c.activo);
      if (!conversacion) {
        return res.status(404).json({ message: 'Conversación no encontrada' });
      }
      if (conversacion.id_cliente !== idUsuario) {
        return res.status(403).json({ message: 'No tienes permisos para enviar mensajes en esta conversación' });
      }
    }

    // Crear el mensaje
    const idMensaje = await getNextId('mensajes.json', 'id_mensaje');
    const nuevoMensaje = {
      id_mensaje: idMensaje,
      id_conversacion: conversacionId,
      emisor_tipo: 'CLIENTE',
      emisor_id: idUsuario,
      contenido: contenido,
      creado_en: new Date().toISOString()
    };
    mensajes.push(nuevoMensaje);
    await writeJson('mensajes.json', mensajes);

    res.status(201).json({
      id_mensaje: nuevoMensaje.id_mensaje,
      id_conversacion: nuevoMensaje.id_conversacion,
      id_remitente: nuevoMensaje.emisor_id,
      contenido: nuevoMensaje.contenido,
      fecha_envio: nuevoMensaje.creado_en
    });
  } catch (error) {
    console.error('Error al enviar mensaje:', error);
    res.status(500).json({ message: error.message || 'Error al enviar mensaje' });
  }
});

// GET /api/cliente/auditorias/:idAuditoria/detalle
// Obtener detalle de una auditoría específica
router.get('/auditorias/:idAuditoria/detalle', authenticate, authorize([3]), async (req, res) => {
  try {
    const idAuditoria = Number(req.params.idAuditoria);
    const idUsuario = req.user.id_usuario;

    const auditorias = await readJson('auditorias.json');
    const empresas = await readJson('empresas.json');
    const estados = await readJson('estados_auditoria.json');
    const auditoriaModulos = await readJson('auditoria_modulos.json');
    const modulosAmbientales = await readJson('modulos_ambientales.json');

    const auditoria = auditorias.find(a => a.id_auditoria === idAuditoria);
    if (!auditoria) {
      return res.status(404).json({ message: 'Auditoría no encontrada' });
    }

    // Verificar que el cliente pertenece a esta auditoría
    if (auditoria.id_cliente !== idUsuario) {
      return res.status(403).json({ message: 'No tienes permisos para ver esta auditoría' });
    }

    const empresaAuditora = empresas.find(e => e.id_empresa === auditoria.id_empresa_auditora);
    const estado = estados.find(e => e.id_estado === auditoria.id_estado);

    // Obtener módulos de la auditoría
    const modulosIds = auditoriaModulos
      .filter(am => am.id_auditoria === idAuditoria)
      .map(am => am.id_modulo);

    const modulos = modulosIds.map(id => {
      const modulo = modulosAmbientales.find(m => m.id_modulo === id);
      return modulo ? { id_modulo: modulo.id_modulo, nombre: modulo.nombre, clave: modulo.clave } : null;
    }).filter(m => m !== null);

    res.json({
      id_auditoria: auditoria.id_auditoria,
      id_cliente: auditoria.id_cliente,
      id_empresa_auditora: auditoria.id_empresa_auditora,
      id_estado: auditoria.id_estado,
      modulos: modulosIds,
      modulos_detalle: modulos,
      fecha_creacion: auditoria.creada_en || auditoria.creado_en,
      fecha_inicio: auditoria.fecha_inicio || null,
      monto: auditoria.monto || null,
      empresa_auditora: empresaAuditora ? {
        id_empresa: empresaAuditora.id_empresa,
        nombre: empresaAuditora.nombre
      } : null,
      estado_actual: estado ? {
        id_estado: estado.id_estado,
        nombre: estado.nombre || estado.clave
      } : null
    });
  } catch (error) {
    console.error('Error al obtener detalle de auditoría:', error);
    res.status(500).json({ message: error.message || 'Error al obtener detalle de auditoría' });
  }
});

// ==========================================
// RUTAS DE NOTIFICACIONES
// ==========================================

// GET /api/cliente/notificaciones/:idCliente
// Obtener todas las notificaciones del cliente
router.get('/notificaciones/:idCliente', authenticate, authorize([3]), async (req, res) => {
  try {
    const idCliente = Number(req.params.idCliente);
    const idUsuario = req.user.id_usuario;

    // Verificar que el cliente está pidiendo sus propias notificaciones
    if (idCliente !== idUsuario) {
      return res.status(403).json({ message: 'No tienes permisos para ver estas notificaciones' });
    }

    const notificaciones = await readJson('notificaciones.json');
    const auditorias = await readJson('auditorias.json');
    const empresas = await readJson('empresas.json');

    // Filtrar notificaciones del cliente y enriquecer con datos de auditoría
    const notificacionesCliente = notificaciones
      .filter(n => n.id_cliente === idCliente)
      .map(notificacion => {
        let auditoriaData = null;
        
        if (notificacion.id_auditoria) {
          const auditoria = auditorias.find(a => a.id_auditoria === notificacion.id_auditoria);
          if (auditoria) {
            const empresa = empresas.find(e => e.id_empresa === auditoria.id_empresa_auditora);
            auditoriaData = {
              id_auditoria: auditoria.id_auditoria,
              empresa: empresa ? {
                id_empresa: empresa.id_empresa,
                nombre: empresa.nombre
              } : null
            };
          }
        }

        return {
          id_notificacion: notificacion.id_notificacion,
          id_cliente: notificacion.id_cliente,
          id_auditoria: notificacion.id_auditoria,
          tipo: notificacion.tipo,
          titulo: notificacion.titulo,
          mensaje: notificacion.mensaje,
          fecha: notificacion.fecha,
          leida: notificacion.leida,
          auditoria: auditoriaData
        };
      })
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha)); // Más recientes primero

    res.json(notificacionesCliente);
  } catch (error) {
    console.error('Error al obtener notificaciones:', error);
    res.status(500).json({ message: error.message || 'Error al obtener notificaciones' });
  }
});

// PUT /api/cliente/notificaciones/:idNotificacion/leer
// Marcar una notificación como leída
router.put('/notificaciones/:idNotificacion/leer', authenticate, authorize([3]), async (req, res) => {
  try {
    const idNotificacion = Number(req.params.idNotificacion);
    const idUsuario = req.user.id_usuario;

    const notificaciones = await readJson('notificaciones.json');
    const notificacionIdx = notificaciones.findIndex(n => n.id_notificacion === idNotificacion);

    if (notificacionIdx === -1) {
      return res.status(404).json({ message: 'Notificación no encontrada' });
    }

    // Verificar que la notificación pertenece al cliente
    if (notificaciones[notificacionIdx].id_cliente !== idUsuario) {
      return res.status(403).json({ message: 'No tienes permisos para marcar esta notificación como leída' });
    }

    // Marcar como leída
    notificaciones[notificacionIdx].leida = true;
    await writeJson('notificaciones.json', notificaciones);

    res.json({ 
      message: 'Notificación marcada como leída',
      notificacion: notificaciones[notificacionIdx]
    });
  } catch (error) {
    console.error('Error al marcar notificación como leída:', error);
    res.status(500).json({ message: error.message || 'Error al marcar notificación como leída' });
  }
});

// PUT /api/cliente/notificaciones/:idCliente/leer-todas
// Marcar todas las notificaciones del cliente como leídas
router.put('/notificaciones/:idCliente/leer-todas', authenticate, authorize([3]), async (req, res) => {
  try {
    const idCliente = Number(req.params.idCliente);
    const idUsuario = req.user.id_usuario;

    // Verificar que el cliente está marcando sus propias notificaciones
    if (idCliente !== idUsuario) {
      return res.status(403).json({ message: 'No tienes permisos para marcar estas notificaciones' });
    }

    const notificaciones = await readJson('notificaciones.json');
    
    // Contar y marcar todas las notificaciones no leídas del cliente
    let contador = 0;
    notificaciones.forEach(notificacion => {
      if (notificacion.id_cliente === idCliente && !notificacion.leida) {
        notificacion.leida = true;
        contador++;
      }
    });

    await writeJson('notificaciones.json', notificaciones);

    res.json({ 
      message: `${contador} notificaciones marcadas como leídas`,
      cantidad_actualizadas: contador
    });
  } catch (error) {
    console.error('Error al marcar todas las notificaciones como leídas:', error);
    res.status(500).json({ message: error.message || 'Error al marcar notificaciones como leídas' });
  }
});


// ==========================================
// RUTAS DE REPORTES
// ==========================================

// GET /api/cliente/reportes/:idCliente
// Obtener todos los reportes de las auditorías del cliente
router.get('/reportes/:idCliente', authenticate, authorize([3]), async (req, res) => {
  try {
    const idCliente = Number(req.params.idCliente);
    const idUsuario = req.user.id_usuario;

    // Verificar que el cliente está pidiendo sus propios reportes
    if (idCliente !== idUsuario) {
      return res.status(403).json({ message: 'No tienes permisos para ver estos reportes' });
    }

    const reportes = await readJson('reportes.json');
    const auditorias = await readJson('auditorias.json');
    const empresas = await readJson('empresas.json');

    // Filtrar reportes de auditorías del cliente
    const reportesCliente = reportes
      .filter(reporte => {
        const auditoria = auditorias.find(a => a.id_auditoria === reporte.id_auditoria);
        return auditoria && auditoria.id_cliente === idCliente;
      })
      .map(reporte => {
        const auditoria = auditorias.find(a => a.id_auditoria === reporte.id_auditoria);
        const empresa = auditoria ? empresas.find(e => e.id_empresa === auditoria.id_empresa_auditora) : null;

        return {
          id_reporte: reporte.id_reporte,
          id_auditoria: reporte.id_auditoria,
          nombre: reporte.nombre || reporte.titulo || 'Reporte sin nombre',
          tipo: reporte.tipo || 'Reporte Final',
          fecha_elaboracion: reporte.fecha_elaboracion || reporte.creado_en || reporte.fecha,
          fecha_subida: reporte.fecha_subida || reporte.creado_en || reporte.fecha,
          url: reporte.url || reporte.archivo_url || null,
          auditoria: auditoria ? {
            id_auditoria: auditoria.id_auditoria,
            empresa: empresa ? {
              id_empresa: empresa.id_empresa,
              nombre: empresa.nombre
            } : null
          } : null
        };
      })
      .sort((a, b) => {
        // Ordenar por fecha_elaboracion DESC (más recientes primero)
        const fechaA = new Date(a.fecha_elaboracion);
        const fechaB = new Date(b.fecha_elaboracion);
        return fechaB - fechaA;
      });

    res.json(reportesCliente);
  } catch (error) {
    console.error('Error al obtener reportes:', error);
    res.status(500).json({ message: error.message || 'Error al obtener reportes' });
  }
});

// GET /api/cliente/auditorias/:idAuditoria/reporte
// Descargar el reporte de una auditoría específica
router.get('/auditorias/:idAuditoria/reporte', authenticate, authorize([3]), async (req, res) => {
  try {
    const idAuditoria = Number(req.params.idAuditoria);
    const idUsuario = req.user.id_usuario;

    const auditorias = await readJson('auditorias.json');
    const reportes = await readJson('reportes.json');

    // Verificar que la auditoría existe y pertenece al cliente
    const auditoria = auditorias.find(a => a.id_auditoria === idAuditoria);
    if (!auditoria) {
      return res.status(404).json({ message: 'Auditoría no encontrada' });
    }

    if (auditoria.id_cliente !== idUsuario) {
      return res.status(403).json({ message: 'No tienes permisos para ver este reporte' });
    }

    // Buscar el reporte de esta auditoría
    const reporte = reportes.find(r => r.id_auditoria === idAuditoria);
    if (!reporte) {
      return res.status(404).json({ message: 'No hay reporte disponible para esta auditoría' });
    }

    // Obtener la URL del archivo
    const fileUrl = reporte.url || reporte.archivo_url;
    if (!fileUrl) {
      return res.status(404).json({ message: 'Archivo de reporte no encontrado' });
    }

    // Extraer el nombre del archivo de la URL
    // La URL puede ser: http://host/uploads/filename.pdf o /uploads/filename.pdf
    const fileName = fileUrl.split('/').pop();
    const filePath = path.join(__dirname, '..', 'data', 'uploads', fileName);

    // Verificar que el archivo existe
    try {
      await fs.promises.access(filePath);
    } catch (err) {
      return res.status(404).json({ message: 'Archivo de reporte no encontrado en el servidor' });
    }

    // Enviar el archivo PDF directo
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${reporte.nombre_archivo || fileName}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error al descargar reporte:', error);
    res.status(500).json({ message: error.message || 'Error al descargar reporte' });
  }
});

module.exports = router;