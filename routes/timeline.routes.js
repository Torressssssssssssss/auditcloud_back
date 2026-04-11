// Rutas de timeline: consulta el historial de auditorias por empresa.
const express = require('express');
const router = express.Router();
const { readJson, writeJson, getNextId } = require('../utils/jsonDb');
const { authenticate, authorize } = require('../utils/auth');

// GET /api/timeline/empresa/:idEmpresa
// Timeline de auditorias por empresa
router.get('/empresa/:idEmpresa', authenticate, async (req, res) => {
  try {
    const idEmpresa = Number(req.params.idEmpresa);
    console.log(`[Timeline] Buscando historial para Empresa ID: ${idEmpresa}`);

    const auditorias = await readJson('auditorias.json');
    const evidencias = await readJson('evidencias.json');
    const comentarios = await readJson('comentarios.json');
    const usuarios = await readJson('usuarios.json');

    // IDs de usuarios de la empresa (compatible con auditorias antiguas)
    const idsUsuariosDeEmpresa = usuarios
      .filter(u => u.id_empresa === idEmpresa)
      .map(u => u.id_usuario);

    console.log(`[Timeline] Usuarios encontrados de la empresa: ${idsUsuariosDeEmpresa.join(', ')}`);

    // Filtrar auditorias por empresa o por usuario cliente
    const misAuditorias = auditorias.filter(a => {
      // Caso A: auditoria con id_empresa_cliente
      const esPorEmpresaDirecta = a.id_empresa_cliente === idEmpresa;
      
      // Caso B: auditoria por id_cliente
      const esPorUsuario = idsUsuariosDeEmpresa.includes(a.id_cliente);

      return esPorEmpresaDirecta || esPorUsuario;
    });

    console.log(`[Timeline] Auditorías encontradas: ${misAuditorias.length}`);

    // Construir respuesta
    const resultado = misAuditorias.map(audit => {
      // Items de esta auditoria
      const misEvidencias = evidencias.filter(e => e.id_auditoria === audit.id_auditoria);
      const misComentarios = comentarios.filter(c => c.id_auditoria === audit.id_auditoria);
      
      const items = [];

      // Mapear evidencias
      misEvidencias.forEach(e => {
        const autor = usuarios.find(u => u.id_usuario === e.id_auditor);
        items.push({
          id: `EVI-${e.id_evidencia}`,
          tipo: 'EVIDENCIA',
          subtipo: e.tipo,
          descripcion: e.descripcion,
          url: e.url,
          nombre_archivo: e.nombre_archivo,
          autor: autor ? autor.nombre : 'Auditor',
          fecha: e.creado_en
        });
      });

      // Mapear comentarios
      misComentarios.forEach(c => {
        const autor = usuarios.find(u => u.id_usuario === c.id_usuario);
        items.push({
          id: `COM-${c.id_comentario}`,
          tipo: 'COMENTARIO',
          descripcion: c.mensaje,
          autor: autor ? autor.nombre : 'Usuario',
          fecha: c.creado_en
        });
      });

      // Ordenar items por fecha
      items.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

      return {
        id_auditoria: audit.id_auditoria,
        fecha_creacion: audit.creada_en || audit.fecha_creacion,
        estado: audit.id_estado, 
        items: items
      };
    });

    // Ordenar auditorias por fecha
    resultado.sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));

    res.json(resultado);

  } catch (error) {
    console.error('[Timeline Error]', error);
    res.status(500).json({ message: 'Error cargando historial de empresa' });
  }
});

// GET /api/timeline/:idAuditoria
router.get('/:idAuditoria', authenticate, async (req, res) => {
  try {
    const idAuditoria = Number(req.params.idAuditoria);
    const auditorias = await readJson('auditorias.json');
    
    const auditoria = auditorias.find(a => a.id_auditoria === idAuditoria);
    if (!auditoria) return res.status(404).json({ message: 'Auditoría no encontrada' });

    // Seguridad: permitir cliente o empresa auditora
    const esCliente = auditoria.id_cliente === req.user.id_usuario;
    const esMiEmpresa = auditoria.id_empresa_auditora === req.user.id_empresa; // roles 1 y 2

    if (!esCliente && !esMiEmpresa) {
      return res.status(403).json({ message: 'Acceso denegado a esta bitácora' });
    }

    // Cargar evidencias, comentarios y usuarios
    const evidencias = await readJson('evidencias.json');
    const comentarios = await readJson('comentarios.json');
    const usuarios = await readJson('usuarios.json');
    const timeline = [];
    
    // Armar timeline y responder
    
    res.json(timeline);

  } catch (error) {
    res.status(500).json({ message: 'Error timeline' });
  }
});

// POST /api/timeline/comentarios
// Crear comentario
router.post('/comentarios', authenticate, authorize([1, 2]), async (req, res) => {
  const { id_auditoria, mensaje } = req.body;
  
  if (!id_auditoria || !mensaje) {
    return res.status(400).json({ message: 'Faltan datos' });
  }

  const comentarios = await readJson('comentarios.json');
  const idComentario = await getNextId('comentarios.json', 'id_comentario');

  const nuevo = {
    id_comentario: idComentario,
    id_auditoria: Number(id_auditoria),
    id_usuario: req.user.id_usuario,
    mensaje,
    creado_en: new Date().toISOString()
  };

  comentarios.push(nuevo);
  await writeJson('comentarios.json', comentarios);

  res.status(201).json(nuevo);
});

// POST /api/timeline/comentarios
// Crear comentario
router.post('/comentarios', authenticate, authorize([1, 2]), async (req, res) => {
  const { id_auditoria, mensaje } = req.body;
  
  if (!id_auditoria || !mensaje) {
    return res.status(400).json({ message: 'Faltan datos' });
  }

  const comentarios = await readJson('comentarios.json');
  const idComentario = await getNextId('comentarios.json', 'id_comentario');

  const nuevo = {
    id_comentario: idComentario,
    id_auditoria: Number(id_auditoria),
    id_usuario: req.user.id_usuario,
    mensaje,
    creado_en: new Date().toISOString()
  };

  comentarios.push(nuevo);
  await writeJson('comentarios.json', comentarios);

  res.status(201).json(nuevo);
});

module.exports = router;