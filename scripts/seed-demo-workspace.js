require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { query, getPool } = require('../utils/db');
const { readJson, writeJson } = require('../utils/jsonDb');
const { indexAuditoria, pingElasticsearch } = require('../services/elasticsearchAuditorias.service');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DEMO_PREFIX = 'DEMO -';
const SUPERVISOR_EMAIL = 'supervisor@auditcloud.com';
const AUDITOR_EMAIL = 'auditor@auditcloud.com';

const ESTADOS = [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 1, 2, 2, 3];
const ESTADOS_MEXICO = [
  'Aguascalientes',
  'Jalisco',
  'Queretaro',
  'Guanajuato',
  'Ciudad de Mexico',
  'Estado de Mexico',
  'Nuevo Leon',
  'Puebla',
  'Veracruz',
  'Yucatan'
];

const EMPRESAS = [
  ['Norte Circular Manufactura', 'Manufactura'],
  ['Bajio Envases Sustentables', 'Empaque'],
  ['Altiplano Textil Operaciones', 'Textil'],
  ['Puerto Verde Logistica', 'Logistica'],
  ['Metales Claros Planta Centro', 'Metal mecanica'],
  ['Lacteos Sierra Azul', 'Alimentos'],
  ['Quimica Responsable del Bajio', 'Quimica'],
  ['Solaris Componentes', 'Electronica'],
  ['Agroinsumos Valle Norte', 'Agroindustria'],
  ['Ceramica Urbana MX', 'Construccion'],
  ['Frio Integral Peninsular', 'Cadena de frio'],
  ['Papelera Horizonte', 'Papel'],
  ['Tecnologia Hidrica Aplicada', 'Servicios'],
  ['Parque Industrial Loma Alta', 'Administracion industrial'],
  ['Alimentos Rio Claro', 'Alimentos'],
  ['Recicladora Punto Verde', 'Reciclaje'],
  ['Farmaceutica Costa Centro', 'Farmaceutica'],
  ['Bebidas del Sureste', 'Bebidas'],
  ['Vidrio Tecnico Nacional', 'Vidrio'],
  ['Maderas Certificadas del Centro', 'Madera']
];

const EVIDENCE_NAMES = [
  ['evidencia_consumo_energia.pdf', 'DOC', 'Revision de recibos y bitacoras de consumo electrico.'],
  ['foto_medidor_agua.png', 'IMAGEN', 'Fotografia demo de medidor y area de suministro de agua.'],
  ['comprobante_residuos.pdf', 'DOC', 'Comprobante demo de manejo y salida de residuos.'],
  ['inspeccion_area_produccion.png', 'IMAGEN', 'Imagen demo de inspeccion visual en area de produccion.'],
  ['registro_mantenimiento.pdf', 'DOC', 'Registro demo de mantenimiento preventivo ambiental.']
];

function isoDaysAgo(days, hour = 12) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function mysqlDate(value) {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function nextId(items, field, min = 1) {
  return Math.max(min - 1, ...items.map((item) => Number(item[field]) || 0)) + 1;
}

function pushIfMissing(items, field, value, item) {
  const existing = items.find((row) => Number(row[field]) === Number(value));
  if (existing) return { item: existing, created: false };
  items.push(item);
  return { item, created: true };
}

async function nextMysqlId(table, field, min = 1) {
  const rows = await query(`SELECT MAX(${field}) AS max_id FROM ${table}`);
  return Math.max(min - 1, Number(rows[0]?.max_id) || 0) + 1;
}

async function findOne(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function ensureMysqlEmpresa(def) {
  const existing = await findOne('SELECT id_empresa FROM empresas WHERE nombre = ? LIMIT 1', [def.nombre]);
  if (existing) return { id: Number(existing.id_empresa), created: false };

  const id = await nextMysqlId('empresas', 'id_empresa', 20002);
  await query(
    `INSERT INTO empresas (
      id_empresa, id_tipo_empresa, tipo_auditoria, nombre, rfc, giro, direccion,
      ciudad, estado, pais, contacto_nombre, contacto_correo, contacto_telefono, activo
    ) VALUES (?, 2, 'AMBIENTAL', ?, ?, ?, ?, ?, ?, 'Mexico', ?, ?, ?, 1)`,
    [
      id,
      def.nombre,
      def.rfc,
      def.giro,
      def.direccion,
      def.ciudad,
      def.estado,
      def.contacto_nombre,
      def.contacto_correo,
      def.contacto_telefono
    ]
  );
  return { id, created: true };
}

async function ensureMysqlUsuario(def) {
  const existing = await findOne('SELECT id_usuario FROM usuarios WHERE correo = ? LIMIT 1', [def.correo]);
  if (existing) return { id: Number(existing.id_usuario), created: false };

  const id = await nextMysqlId('usuarios', 'id_usuario', 1001);
  await query(
    `INSERT INTO usuarios (
      id_usuario, id_empresa, nombre, correo, password_hash, id_rol, activo, google_id, creado_en
    ) VALUES (?, ?, ?, ?, NULL, ?, 1, NULL, ?)`,
    [id, def.id_empresa, def.nombre, def.correo, def.id_rol, mysqlDate(def.creado_en)]
  );
  return { id, created: true };
}

async function ensureMysqlSolicitud(def) {
  const existing = await findOne(
    'SELECT id_solicitud FROM solicitudes_pago WHERE id_empresa_auditora = ? AND concepto = ? LIMIT 1',
    [def.id_empresa_auditora, def.concepto]
  );
  if (existing) return { id: Number(existing.id_solicitud), created: false };

  const id = await nextMysqlId('solicitudes_pago', 'id_solicitud', 501);
  await query(
    `INSERT INTO solicitudes_pago (
      id_solicitud, id_empresa, id_empresa_auditora, id_empresa_cliente, id_cliente,
      monto, concepto, id_estado, creado_en, creado_por_supervisor, creado_por_auditor,
      pagada_en, paypal_order_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
    [
      id,
      def.id_empresa,
      def.id_empresa_auditora,
      def.id_empresa_cliente,
      def.id_cliente,
      def.monto,
      def.concepto,
      def.id_estado,
      mysqlDate(def.creado_en),
      def.creado_por_supervisor,
      def.pagada_en ? mysqlDate(def.pagada_en) : null
    ]
  );
  return { id, created: true };
}

async function ensureMysqlAuditoria(def) {
  const existing = await findOne(
    'SELECT id_auditoria FROM auditorias WHERE id_empresa_auditora = ? AND objetivo = ? LIMIT 1',
    [def.id_empresa_auditora, def.objetivo]
  );
  if (existing) return { id: Number(existing.id_auditoria), created: false };

  const id = await nextMysqlId('auditorias', 'id_auditoria', 501);
  await query(
    `INSERT INTO auditorias (
      id_auditoria, id_empresa_auditora, id_cliente, id_solicitud_pago, id_estado,
      monto, creada_en, objetivo, estado_actualizado_en, fecha_inicio
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      def.id_empresa_auditora,
      def.id_cliente,
      def.id_solicitud_pago,
      def.id_estado,
      def.monto,
      mysqlDate(def.creada_en),
      def.objetivo,
      mysqlDate(def.estado_actualizado_en),
      dateOnly(def.fecha_inicio)
    ]
  );
  return { id, created: true };
}

async function ensureMysqlSimple(table, idField, lookupSql, lookupParams, insertSql, insertParams, minId) {
  const existing = await findOne(lookupSql, lookupParams);
  if (existing) return { id: Number(existing[idField]), created: false };

  const id = await nextMysqlId(table, idField, minId);
  await query(insertSql, [id, ...insertParams]);
  return { id, created: true };
}

function writePdf(filePath, title, lines) {
  if (fs.existsSync(filePath)) return false;
  const text = [title, ...lines].join('\\n');
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${escaped.length + 64} >>
stream
BT
/F1 16 Tf
72 720 Td
(${escaped}) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000274 00000 n 
0000000000 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF
`;
  fs.writeFileSync(filePath, pdf, 'utf8');
  return true;
}

function writePng(filePath) {
  if (fs.existsSync(filePath)) return false;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAIAAAD2HxkiAAAAGXRFWHRTb2Z0d2FyZQBBdWRpdENsb3VkIERlbW9cAB6aAAABXUlEQVR4nO3SwQ3AIAwEwYz//7MGEgqpgCu0gkmnZXtdAAD8ztsBAPxGSAiChCBICIKEXJ4Or38awXEmo0d0jWm+ZxW1Nq5Y71Jt7xw9c9q9sH3fX9gqVd9r5b2eQ0iAIBIgiAQIIgGCSIAgEiCIBAgigYbq4J5nZgAA+I0QEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIhIRASAiEhEBICISEQEgIh8QJYSwHMYk1VnAAAAABJRU5ErkJggg==',
    'base64'
  );
  fs.writeFileSync(filePath, png);
  return true;
}

async function loadJsonState() {
  const files = [
    'usuarios',
    'empresas',
    'auditorias',
    'solicitudes_pago',
    'evidencias',
    'reportes',
    'conversaciones',
    'mensajes',
    'auditoria_participantes',
    'auditoria_modulos',
    'comentarios',
    'notificaciones',
    'modulos_ambientales'
  ];
  const state = {};
  for (const name of files) {
    state[name] = await readJson(`${name}.json`);
  }
  return state;
}

async function saveJsonState(state) {
  const files = Object.keys(state).filter((name) => name !== 'modulos_ambientales');
  for (const name of files) {
    await writeJson(`${name}.json`, state[name]);
  }
}

async function main() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const state = await loadJsonState();
  const summary = {
    empresas: 0,
    usuariosCliente: 0,
    auditorias: 0,
    solicitudesPago: 0,
    evidencias: 0,
    reportes: 0,
    conversaciones: 0,
    mensajes: 0,
    timelineComentarios: 0,
    archivosGenerados: 0,
    elasticIndexados: 0,
    elasticErrores: 0
  };

  const supervisor = await findOne(
    'SELECT id_usuario, id_empresa, nombre, correo FROM usuarios WHERE correo = ? LIMIT 1',
    [SUPERVISOR_EMAIL]
  );
  const auditor = await findOne(
    'SELECT id_usuario, id_empresa, nombre, correo FROM usuarios WHERE correo = ? LIMIT 1',
    [AUDITOR_EMAIL]
  );

  if (!supervisor || !auditor) {
    throw new Error('No se encontraron supervisor/auditor demo en MySQL.');
  }

  if (!state.usuarios.some((u) => Number(u.id_usuario) === Number(auditor.id_usuario))) {
    state.usuarios.push({
      id_usuario: Number(auditor.id_usuario),
      id_empresa: Number(auditor.id_empresa),
      nombre: auditor.nombre,
      correo: auditor.correo,
      password_hash: null,
      id_rol: 2,
      activo: true,
      creado_en: isoDaysAgo(170)
    });
  }

  const empresaAuditoraId = Number(supervisor.id_empresa);
  const moduloIds = state.modulos_ambientales.length
    ? state.modulos_ambientales.map((m) => Number(m.id_modulo))
    : [1, 2, 3];

  const companyRefs = [];
  for (let i = 0; i < EMPRESAS.length; i += 1) {
    const [baseName, giro] = EMPRESAS[i];
    const nombre = `${DEMO_PREFIX} ${baseName}`;
    const estado = ESTADOS_MEXICO[i % ESTADOS_MEXICO.length];
    const ciudad = i % 2 === 0 ? 'Zona Industrial' : 'Parque Empresarial';
    const contactoCorreo = `demo.cliente.${String(i + 1).padStart(2, '0')}@auditcloud.test`;
    const creadoEn = isoDaysAgo(165 - i * 3, 10);

    const mysqlEmpresa = await ensureMysqlEmpresa({
      nombre,
      rfc: `DEM${String(i + 1).padStart(6, '0')}A1`,
      giro,
      direccion: `Circuito Industrial ${100 + i}`,
      ciudad,
      estado,
      contacto_nombre: `Contacto Demo ${String(i + 1).padStart(2, '0')}`,
      contacto_correo: contactoCorreo,
      contacto_telefono: `555-010-${String(i + 1).padStart(4, '0')}`
    });
    if (mysqlEmpresa.created) summary.empresas += 1;

    const mysqlUsuario = await ensureMysqlUsuario({
      id_empresa: mysqlEmpresa.id,
      nombre: `Cliente Demo ${String(i + 1).padStart(2, '0')}`,
      correo: contactoCorreo,
      id_rol: 3,
      creado_en: creadoEn
    });
    if (mysqlUsuario.created) summary.usuariosCliente += 1;

    pushIfMissing(state.empresas, 'id_empresa', mysqlEmpresa.id, {
      id_empresa: mysqlEmpresa.id,
      id_tipo_empresa: 2,
      nombre,
      rfc: `DEM${String(i + 1).padStart(6, '0')}A1`,
      giro,
      direccion: `Circuito Industrial ${100 + i}`,
      ciudad,
      estado,
      pais: 'Mexico',
      contacto_nombre: `Contacto Demo ${String(i + 1).padStart(2, '0')}`,
      contacto_correo: contactoCorreo,
      contacto_telefono: `555-010-${String(i + 1).padStart(4, '0')}`,
      activo: true
    });

    pushIfMissing(state.usuarios, 'id_usuario', mysqlUsuario.id, {
      id_usuario: mysqlUsuario.id,
      id_empresa: mysqlEmpresa.id,
      nombre: `Cliente Demo ${String(i + 1).padStart(2, '0')}`,
      correo: contactoCorreo,
      password_hash: null,
      id_rol: 3,
      activo: true,
      creado_en: creadoEn
    });

    companyRefs.push({ empresaId: mysqlEmpresa.id, usuarioId: mysqlUsuario.id, nombre, contactoCorreo });
  }

  for (let i = 0; i < ESTADOS.length; i += 1) {
    const idx = i + 1;
    const ref = companyRefs[i % companyRefs.length];
    const estado = ESTADOS[i];
    const createdDaysAgo = 160 - i * 4;
    const creadaEn = isoDaysAgo(createdDaysAgo, 9 + (i % 6));
    const fechaInicio = isoDaysAgo(Math.max(createdDaysAgo - 3, 3), 9);
    const estadoActualizado = isoDaysAgo(Math.max(createdDaysAgo - (estado === 1 ? 1 : estado === 2 ? 18 : 42), 1), 16);
    const monto = 18500 + i * 950;
    const auditLabel = String(idx).padStart(2, '0');
    const concepto = `${DEMO_PREFIX} Servicio de auditoria ambiental ${auditLabel} - ${ref.nombre.replace(`${DEMO_PREFIX} `, '')}`;
    const objetivo = `${DEMO_PREFIX} Auditoria ambiental ${auditLabel} para ${ref.nombre.replace(`${DEMO_PREFIX} `, '')}`;
    const solicitudEstado = i % 7 === 0 && estado === 1 ? 1 : 2;
    const pagadaEn = solicitudEstado === 2 ? isoDaysAgo(Math.max(createdDaysAgo - 2, 2), 13) : null;

    const mysqlSolicitud = await ensureMysqlSolicitud({
      id_empresa: empresaAuditoraId,
      id_empresa_auditora: empresaAuditoraId,
      id_empresa_cliente: ref.empresaId,
      id_cliente: ref.usuarioId,
      monto,
      concepto,
      id_estado: solicitudEstado,
      creado_en: isoDaysAgo(createdDaysAgo + 7, 11),
      creado_por_supervisor: Number(supervisor.id_usuario),
      pagada_en: pagadaEn
    });
    if (mysqlSolicitud.created) summary.solicitudesPago += 1;

    const mysqlAuditoria = await ensureMysqlAuditoria({
      id_empresa_auditora: empresaAuditoraId,
      id_cliente: ref.usuarioId,
      id_solicitud_pago: mysqlSolicitud.id,
      id_estado: estado,
      monto,
      creada_en: creadaEn,
      objetivo,
      estado_actualizado_en: estadoActualizado,
      fecha_inicio: fechaInicio
    });
    if (mysqlAuditoria.created) summary.auditorias += 1;

    pushIfMissing(state.solicitudes_pago, 'id_solicitud', mysqlSolicitud.id, {
      id_solicitud: mysqlSolicitud.id,
      id_empresa: empresaAuditoraId,
      id_empresa_auditora: empresaAuditoraId,
      id_empresa_cliente: ref.empresaId,
      id_cliente: ref.usuarioId,
      monto,
      concepto,
      id_estado: solicitudEstado,
      creado_en: isoDaysAgo(createdDaysAgo + 7, 11),
      creado_por_supervisor: Number(supervisor.id_usuario),
      pagada_en: pagadaEn
    });

    pushIfMissing(state.auditorias, 'id_auditoria', mysqlAuditoria.id, {
      id_auditoria: mysqlAuditoria.id,
      id_empresa_auditora: empresaAuditoraId,
      id_cliente: ref.usuarioId,
      id_empresa_cliente: ref.empresaId,
      id_solicitud_pago: mysqlSolicitud.id,
      id_estado: estado,
      objetivo,
      monto,
      fecha_inicio: fechaInicio,
      creada_en: creadaEn,
      creado_por_supervisor: Number(supervisor.id_usuario),
      estado_actualizado_en: estadoActualizado
    });

    const participante = pushIfMissing(state.auditoria_participantes, 'id_participante', mysqlAuditoria.id, {
      id_participante: mysqlAuditoria.id,
      id_auditoria: mysqlAuditoria.id,
      id_auditor: Number(auditor.id_usuario),
      asignado_en: isoDaysAgo(Math.max(createdDaysAgo - 1, 1), 14)
    });
    if (participante.created) {
      await ensureMysqlSimple(
        'auditoria_participantes',
        'id_participante',
        'SELECT id_participante FROM auditoria_participantes WHERE id_auditoria = ? AND id_auditor = ? LIMIT 1',
        [mysqlAuditoria.id, Number(auditor.id_usuario)],
        'INSERT INTO auditoria_participantes (id_participante, id_auditoria, id_auditor, asignado_en) VALUES (?, ?, ?, ?)',
        [mysqlAuditoria.id, Number(auditor.id_usuario), mysqlDate(isoDaysAgo(Math.max(createdDaysAgo - 1, 1), 14))],
        501
      );
    }

    const selectedModules = moduloIds.slice(0, 1 + (i % Math.min(3, moduloIds.length)));
    for (const idModulo of selectedModules) {
      const existsJsonModulo = state.auditoria_modulos.some(
        (m) => Number(m.id_auditoria) === mysqlAuditoria.id && Number(m.id_modulo) === idModulo
      );
      if (!existsJsonModulo) {
        state.auditoria_modulos.push({
          id_auditoria_modulo: nextId(state.auditoria_modulos, 'id_auditoria_modulo', 1001),
          id_auditoria: mysqlAuditoria.id,
          id_modulo: idModulo,
          registrado_en: isoDaysAgo(Math.max(createdDaysAgo - 1, 1), 15)
        });
      }
      await ensureMysqlSimple(
        'auditoria_modulos',
        'id_auditoria_modulo',
        'SELECT id_auditoria_modulo FROM auditoria_modulos WHERE id_auditoria = ? AND id_modulo = ? LIMIT 1',
        [mysqlAuditoria.id, idModulo],
        'INSERT INTO auditoria_modulos (id_auditoria_modulo, id_auditoria, id_modulo, registrado_en) VALUES (?, ?, ?, ?)',
        [mysqlAuditoria.id, idModulo, mysqlDate(isoDaysAgo(Math.max(createdDaysAgo - 1, 1), 15))],
        1001
      );
    }

    const convSubject = `${DEMO_PREFIX} Auditoria ${auditLabel} - ${ref.nombre.replace(`${DEMO_PREFIX} `, '')}`;
    let conv = state.conversaciones.find((c) => c.asunto === convSubject && Number(c.id_cliente) === ref.usuarioId);
    if (!conv) {
      conv = {
        id_conversacion: nextId(state.conversaciones, 'id_conversacion', 251),
        id_cliente: ref.usuarioId,
        id_empresa_auditora: empresaAuditoraId,
        tipo_conversacion: 'COMERCIAL',
        id_auditoria: mysqlAuditoria.id,
        id_usuario_cliente: ref.usuarioId,
        id_usuario_supervisor: Number(supervisor.id_usuario),
        id_usuario_auditor: Number(auditor.id_usuario),
        asunto: convSubject,
        creado_en: isoDaysAgo(createdDaysAgo + 4, 12),
        estado: 'ABIERTA',
        activo: true
      };
      state.conversaciones.push(conv);
      summary.conversaciones += 1;
    }
    const mysqlConv = await ensureMysqlSimple(
      'conversaciones',
      'id_conversacion',
      'SELECT id_conversacion FROM conversaciones WHERE id_cliente = ? AND id_empresa_auditora = ? AND asunto = ? LIMIT 1',
      [ref.usuarioId, empresaAuditoraId, convSubject],
      'INSERT INTO conversaciones (id_conversacion, id_cliente, id_empresa_auditora, asunto, creado_en, ultimo_mensaje_fecha, activo) VALUES (?, ?, ?, ?, ?, ?, 1)',
      [ref.usuarioId, empresaAuditoraId, convSubject, mysqlDate(conv.creado_en), mysqlDate(estadoActualizado)],
      251
    );
    conv.id_conversacion = mysqlConv.id;

    const messageTemplates = [
      ['CLIENTE', ref.usuarioId, 'Buen dia, compartimos la informacion inicial para preparar la auditoria.'],
      ['SUPERVISOR', Number(supervisor.id_usuario), 'Gracias. La solicitud quedo registrada y asignaremos seguimiento.'],
      ['AUDITOR', Number(auditor.id_usuario), 'Ya revise el alcance y agregue las evidencias iniciales al expediente.']
    ];
    if (estado === 3) {
      messageTemplates.push(['SUPERVISOR', Number(supervisor.id_usuario), 'El reporte final quedo disponible para revision.']);
    }
    for (let m = 0; m < messageTemplates.length; m += 1) {
      const [tipo, emisorId, contenidoBase] = messageTemplates[m];
      const contenido = `${DEMO_PREFIX} ${contenidoBase}`;
      const existsMsg = state.mensajes.some(
        (msg) => Number(msg.id_conversacion) === mysqlConv.id && msg.contenido === contenido
      );
      const msgDate = isoDaysAgo(Math.max(createdDaysAgo - 5 - m * 6, 1), 10 + m);
      if (!existsMsg) {
        const idMensaje = nextId(state.mensajes, 'id_mensaje', 501);
        state.mensajes.push({
          id_mensaje: idMensaje,
          id_conversacion: mysqlConv.id,
          emisor_tipo: tipo,
          emisor_id: emisorId,
          contenido,
          creado_en: msgDate
        });
        summary.mensajes += 1;
      }
      await ensureMysqlSimple(
        'mensajes',
        'id_mensaje',
        'SELECT id_mensaje FROM mensajes WHERE id_conversacion = ? AND emisor_tipo = ? AND contenido = ? LIMIT 1',
        [mysqlConv.id, tipo, contenido],
        'INSERT INTO mensajes (id_mensaje, id_conversacion, emisor_tipo, emisor_id, contenido, creado_en) VALUES (?, ?, ?, ?, ?, ?)',
        [mysqlConv.id, tipo, emisorId, contenido, mysqlDate(msgDate)],
        501
      );
    }
    conv.ultimo_mensaje_fecha = isoDaysAgo(Math.max(createdDaysAgo - 18, 1), 17);

    const auditSubject = DEMO_PREFIX + " Bitacora auditoria " + auditLabel + " - " + ref.nombre.replace(DEMO_PREFIX + " ", "");
    let auditConv = state.conversaciones.find(
      (c) => c.asunto === auditSubject && Number(c.id_auditoria) === mysqlAuditoria.id
    );
    if (!auditConv) {
      auditConv = {
        id_conversacion: nextId(state.conversaciones, "id_conversacion", 251),
        id_cliente: ref.usuarioId,
        id_empresa_auditora: empresaAuditoraId,
        tipo_conversacion: "AUDITORIA",
        id_auditoria: mysqlAuditoria.id,
        id_usuario_cliente: ref.usuarioId,
        id_usuario_supervisor: Number(supervisor.id_usuario),
        id_usuario_auditor: Number(auditor.id_usuario),
        id_auditor: Number(auditor.id_usuario),
        asunto: auditSubject,
        creado_en: isoDaysAgo(createdDaysAgo + 2, 12),
        estado: "ABIERTA",
        activo: true
      };
      state.conversaciones.push(auditConv);
      summary.conversaciones += 1;
    }
    const mysqlAuditConv = await ensureMysqlSimple(
      "conversaciones",
      "id_conversacion",
      "SELECT id_conversacion FROM conversaciones WHERE id_cliente = ? AND id_empresa_auditora = ? AND asunto = ? LIMIT 1",
      [ref.usuarioId, empresaAuditoraId, auditSubject],
      "INSERT INTO conversaciones (id_conversacion, id_cliente, id_empresa_auditora, asunto, creado_en, ultimo_mensaje_fecha, activo) VALUES (?, ?, ?, ?, ?, ?, 1)",
      [ref.usuarioId, empresaAuditoraId, auditSubject, mysqlDate(auditConv.creado_en), mysqlDate(estadoActualizado)],
      251
    );
    auditConv.id_conversacion = mysqlAuditConv.id;

    const auditMessages = [
      ["AUDITOR", Number(auditor.id_usuario), "Inicio bitacora tecnica y solicitud de evidencias por modulo."],
      ["CLIENTE", ref.usuarioId, "Se cargaron documentos solicitados para revision del auditor."],
      ["AUDITOR", Number(auditor.id_usuario), estado === 3 ? "Hallazgos cerrados y reporte final preparado." : "Seguimiento en curso con evidencias documentales."]
    ];
    for (let m = 0; m < auditMessages.length; m += 1) {
      const [tipo, emisorId, contenidoBase] = auditMessages[m];
      const contenido = DEMO_PREFIX + " " + contenidoBase;
      const existsMsg = state.mensajes.some(
        (msg) => Number(msg.id_conversacion) === mysqlAuditConv.id && msg.contenido === contenido
      );
      const msgDate = isoDaysAgo(Math.max(createdDaysAgo - 7 - m * 7, 1), 13 + m);
      if (!existsMsg) {
        state.mensajes.push({
          id_mensaje: nextId(state.mensajes, "id_mensaje", 501),
          id_conversacion: mysqlAuditConv.id,
          emisor_tipo: tipo,
          emisor_id: emisorId,
          contenido,
          creado_en: msgDate
        });
        summary.mensajes += 1;
      }
      await ensureMysqlSimple(
        "mensajes",
        "id_mensaje",
        "SELECT id_mensaje FROM mensajes WHERE id_conversacion = ? AND emisor_tipo = ? AND contenido = ? LIMIT 1",
        [mysqlAuditConv.id, tipo, contenido],
        "INSERT INTO mensajes (id_mensaje, id_conversacion, emisor_tipo, emisor_id, contenido, creado_en) VALUES (?, ?, ?, ?, ?, ?)",
        [mysqlAuditConv.id, tipo, emisorId, contenido, mysqlDate(msgDate)],
        501
      );
    }
    auditConv.ultimo_mensaje_fecha = isoDaysAgo(Math.max(createdDaysAgo - 21, 1), 16);

    const comments = [
      `${DEMO_PREFIX} Alcance validado con cliente y auditor asignado.`,
      `${DEMO_PREFIX} Seguimiento documental registrado en expediente.`
    ];
    for (let c = 0; c < comments.length; c += 1) {
      const existsComment = state.comentarios.some(
        (comment) => Number(comment.id_auditoria) === mysqlAuditoria.id && comment.mensaje === comments[c]
      );
      const commentDate = isoDaysAgo(Math.max(createdDaysAgo - 8 - c * 8, 1), 11);
      if (!existsComment) {
        state.comentarios.push({
          id_comentario: nextId(state.comentarios, 'id_comentario', 501),
          id_auditoria: mysqlAuditoria.id,
          id_usuario: c === 0 ? Number(supervisor.id_usuario) : Number(auditor.id_usuario),
          mensaje: comments[c],
          creado_en: commentDate
        });
        summary.timelineComentarios += 1;
      }
      await ensureMysqlSimple(
        'comentarios',
        'id_comentario',
        'SELECT id_comentario FROM comentarios WHERE id_auditoria = ? AND mensaje = ? LIMIT 1',
        [mysqlAuditoria.id, comments[c]],
        'INSERT INTO comentarios (id_comentario, id_auditoria, id_usuario, mensaje, creado_en) VALUES (?, ?, ?, ?, ?)',
        [mysqlAuditoria.id, c === 0 ? Number(supervisor.id_usuario) : Number(auditor.id_usuario), comments[c], mysqlDate(commentDate)],
        501
      );
    }

    if (estado !== 1) {
      const evidenceCount = estado === 2 ? 3 : 5;
      for (let e = 0; e < evidenceCount; e += 1) {
        const [baseFileName, tipo, descripcionBase] = EVIDENCE_NAMES[e];
        const ext = path.extname(baseFileName);
        const safeBase = path.basename(baseFileName, ext);
        const fileName = `demo_auditoria_${mysqlAuditoria.id}_${safeBase}${ext}`;
        const filePath = path.join(UPLOAD_DIR, fileName);
        if (ext === '.pdf') {
          if (writePdf(filePath, 'Evidencia demo AuditCloud', [objetivo, descripcionBase])) summary.archivosGenerados += 1;
        } else if (writePng(filePath)) {
          summary.archivosGenerados += 1;
        }
        const evidenceDescription = `${DEMO_PREFIX} ${descripcionBase}`;
        const existsEvidence = state.evidencias.some(
          (ev) => Number(ev.id_auditoria) === mysqlAuditoria.id && ev.nombre_archivo === baseFileName
        );
        const evidenciaFecha = isoDaysAgo(Math.max(createdDaysAgo - 12 - e * 5, 1), 12);
        const modulo = selectedModules[e % selectedModules.length];
        if (!existsEvidence) {
          state.evidencias.push({
            id_evidencia: nextId(state.evidencias, 'id_evidencia', 501),
            id_auditoria: mysqlAuditoria.id,
            id_modulo: modulo,
            id_auditor: Number(auditor.id_usuario),
            tipo,
            descripcion: evidenceDescription,
            nombre_archivo: baseFileName,
            url_archivo: `/uploads/${fileName}`,
            creado_en: evidenciaFecha
          });
          summary.evidencias += 1;
        }
        await ensureMysqlSimple(
          'evidencias',
          'id_evidencia',
          'SELECT id_evidencia FROM evidencias WHERE id_auditoria = ? AND nombre_archivo = ? LIMIT 1',
          [mysqlAuditoria.id, baseFileName],
          'INSERT INTO evidencias (id_evidencia, id_auditoria, id_modulo, id_auditor, tipo, descripcion, nombre_archivo, url_archivo, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
          [mysqlAuditoria.id, modulo, Number(auditor.id_usuario), tipo, evidenceDescription, baseFileName, `/uploads/${fileName}`, mysqlDate(evidenciaFecha)],
          501
        );
      }
    }

    if (estado === 3) {
      const reportFile = `demo_auditoria_${mysqlAuditoria.id}_reporte_final.pdf`;
      const reportPath = path.join(UPLOAD_DIR, reportFile);
      if (writePdf(reportPath, 'Reporte final demo AuditCloud', [objetivo, 'Conclusiones y hallazgos ficticios para entorno demo.'])) {
        summary.archivosGenerados += 1;
      }
      const reportName = `${DEMO_PREFIX} Reporte final auditoria ${auditLabel}`;
      const existsReport = state.reportes.some((r) => Number(r.id_auditoria) === mysqlAuditoria.id && r.nombre === reportName);
      const reportDate = isoDaysAgo(Math.max(createdDaysAgo - 48, 1), 18);
      if (!existsReport) {
        state.reportes.push({
          id_reporte: nextId(state.reportes, 'id_reporte', 501),
          id_auditoria: mysqlAuditoria.id,
          nombre: reportName,
          tipo: 'FINAL',
          observaciones: `${DEMO_PREFIX} Reporte final generado para datos demo.`,
          url: `/uploads/${reportFile}`,
          nombre_archivo: reportFile,
          creado_por: Number(auditor.id_usuario),
          fecha_creacion: reportDate
        });
        summary.reportes += 1;
      }
      await ensureMysqlSimple(
        'reportes',
        'id_reporte',
        'SELECT id_reporte FROM reportes WHERE id_auditoria = ? AND nombre = ? LIMIT 1',
        [mysqlAuditoria.id, reportName],
        'INSERT INTO reportes (id_reporte, id_auditoria, nombre, tipo, observaciones, url, nombre_archivo, creado_por, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [mysqlAuditoria.id, reportName, 'FINAL', `${DEMO_PREFIX} Reporte final generado para datos demo.`, `/uploads/${reportFile}`, reportFile, Number(auditor.id_usuario), mysqlDate(reportDate)],
        501
      );
    }
  }

  await saveJsonState(state);

  const auditoriasMysql = await query(
    `SELECT
      a.id_auditoria,
      a.id_empresa_auditora,
      a.id_cliente,
      cliente.id_empresa AS id_empresa_cliente,
      a.id_solicitud_pago,
      a.id_estado,
      a.monto,
      a.fecha_inicio,
      a.creada_en,
      a.objetivo,
      a.estado_actualizado_en
    FROM auditorias a
    LEFT JOIN usuarios cliente ON cliente.id_usuario = a.id_cliente
    ORDER BY a.id_auditoria`
  );

  const elasticHealth = await pingElasticsearch();
  if (elasticHealth.enabled && elasticHealth.connected) {
    for (const auditoria of auditoriasMysql) {
      const result = await indexAuditoria(auditoria);
      if (result.ok) summary.elasticIndexados += 1;
      else summary.elasticErrores += 1;
    }
  }

  console.log(JSON.stringify({
    summary,
    supervisor: {
      id_usuario: Number(supervisor.id_usuario),
      id_empresa: Number(supervisor.id_empresa),
      correo: supervisor.correo
    },
    auditor: {
      id_usuario: Number(auditor.id_usuario),
      id_empresa: Number(auditor.id_empresa),
      correo: auditor.correo
    },
    elastic: elasticHealth
  }, null, 2));
}

main()
  .catch((error) => {
    console.error('Error ejecutando seed demo:', {
      message: error?.message,
      code: error?.code
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await getPool().end();
    } catch {
      // noop
    }
  });
