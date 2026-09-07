// SQL repository. Arrays are response/domain projections, never file-backed storage.
// Persist only changed rows/columns from a request-local snapshot, in its transaction.
const { query, transactionContext, afterCommit } = require('./db');
const keys = {
  usuarios:'id_usuario', empresas:'id_empresa', conversaciones:'id_conversacion',
  mensajes:'id_mensaje', solicitudes_pago:'id_solicitud', auditorias:'id_auditoria',
  auditoria_participantes:'id_participante', auditoria_modulos:'id_auditoria_modulo',
  empresa_modulos:'id_empresa_modulo', evidencias:'id_evidencia', reportes:'id_reporte',
  notificaciones:'id_notificacion', comentarios:'id_comentario', participantes:'id_participante',
  audiencias:'id_audiencia', roles:'id_rol', tipos_empresa:'id_tipo_empresa',
  estados_auditoria:'id_estado', estados_solicitud_pago:'id_estado', modulos_ambientales:'id_modulo'
};
const schemas = new Map();
function context() {
  const ctx = transactionContext.getStore();
  if (!ctx) throw new Error('Repository requires a transaction');
  return ctx;
}
function tableName(entity) {
  if (!Object.hasOwn(keys, entity)) throw new Error('Unknown SQL entity');
  return '`' + entity + '`';
}
async function schema(entity) {
  tableName(entity);
  if (!schemas.has(entity)) schemas.set(entity, await query('SHOW COLUMNS FROM ' + tableName(entity)));
  return schemas.get(entity);
}
function project(entity, row) {
  const result = {...row};
  for (const [key, value] of Object.entries(result)) {
    if (value instanceof Date) result[key] = value.toISOString();
    if (['activo','leida'].includes(key)) result[key] = Boolean(value);
    if (['monto','mercadopago_transaction_amount'].includes(key) && value !== null) result[key] = Number(value);
  }
  if (entity === 'evidencias') result.url = result.url_archivo;
  if (entity === 'solicitudes_pago') {
    result.id_pago_mercadopago = result.mercadopago_payment_id;
    result.preference_id = result.id_preferencia;
  }
  return result;
}
async function listRows(entity) {
  const rows = (await query('SELECT * FROM ' + tableName(entity))).map(row => project(entity, row));
  context().snapshots.set(entity, structuredClone(rows));
  return rows;
}
async function nextId(entity, field = keys[entity]) {
  if (field !== keys[entity] || !context().write) throw new Error('Invalid ID allocation');
  const table = tableName(entity);
  await query('INSERT IGNORE INTO app_sequences (entity,last_id) VALUES (?,0)',[entity]);
  const [sequence] = await query('SELECT last_id FROM app_sequences WHERE entity=? FOR UPDATE',[entity]);
  const [maximum] = await query(`SELECT COALESCE(MAX(\`${field}\`),0) AS maximum FROM ${table}`);
  const id = Math.max(Number(sequence.last_id), Number(maximum.maximum)) + 1;
  await query('UPDATE app_sequences SET last_id=? WHERE entity=?',[id,entity]);
  return id;
}
function storageValue(column, value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (/^(datetime|timestamp)/.test(column.Type)) {
    const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new Error('Invalid datetime');
    return date.toISOString().slice(0,19).replace('T',' ');
  }
  if (column.Type === 'date') return String(value).slice(0,10);
  if (/^(tinyint|int|bigint|decimal)/.test(column.Type)) return Number(value);
  return value;
}
async function saveRows(entity, rows) {
  const ctx = context();
  if (!ctx.write) throw new Error('Read-only operation attempted a write');
  const baseline = ctx.snapshots.get(entity);
  if (!baseline) throw new Error('Cannot persist without a snapshot');
  const columns = await schema(entity), pk = keys[entity], table = tableName(entity);
  const originals = new Map(baseline.map(row => [row[pk],row]));
  const seen = new Set();
  // Remove explicitly omitted relations before replacements with the same unique key.
  const proposedIds = rows.map(row => row[pk]);
  if (proposedIds.some(id => !Number.isInteger(id)) || new Set(proposedIds).size !== rows.length) throw new Error('Invalid primary keys');
  for (const original of baseline) {
    if (rows.some(row => row[pk] === original[pk])) continue;
    const result = await query(`DELETE FROM ${table} WHERE ${columns.map(c=>'`'+c.Field+'` <=> ?').join(' AND ')}`, columns.map(c=>storageValue(c,original[c.Field])));
    if (result.affectedRows !== 1) { const error = new Error('Concurrent delete'); error.statusCode=409; throw error; }
  }
  for (const row of rows) {
    if (!Number.isInteger(row[pk]) || seen.has(row[pk])) throw new Error('Invalid or duplicate primary key');
    seen.add(row[pk]);
    const original = originals.get(row[pk]);
    if (!original) {
      if (entity === 'empresas' && !row.tipo_auditoria) row.tipo_auditoria = 'AMBIENTAL';
      if (entity === 'empresa_modulos' && !row.registrado_en) row.registrado_en = new Date().toISOString();
      const fields = columns.filter(c => Object.hasOwn(row,c.Field));
      await query(`INSERT INTO ${table} (${fields.map(c=>'`'+c.Field+'`').join(',')}) VALUES (${fields.map(()=>'?').join(',')})`,fields.map(c=>storageValue(c,row[c.Field])));
      continue;
    }
    const changed = columns.filter(c => c.Field !== pk && Object.hasOwn(row,c.Field) && storageValue(c,row[c.Field]) !== storageValue(c,original[c.Field]));
    if (!changed.length) continue;
    const result = await query(`UPDATE ${table} SET ${changed.map(c=>'`'+c.Field+'`=?').join(',')} WHERE \`${pk}\`=? AND ${changed.map(c=>'`'+c.Field+'` <=> ?').join(' AND ')}`,[...changed.map(c=>storageValue(c,row[c.Field])),row[pk],...changed.map(c=>storageValue(c,original[c.Field]))]);
    if (result.affectedRows !== 1) { const error = new Error('Concurrent update'); error.statusCode=409; throw error; }
  }
  ctx.snapshots.set(entity, structuredClone(rows));
}
async function crearNotificacion(data) {
  const rows = await listRows('notificaciones');
  const notification = { id_notificacion:await nextId('notificaciones'),id_cliente:Number(data.id_cliente),id_auditoria:data.id_auditoria ? Number(data.id_auditoria):null,tipo:data.tipo,titulo:data.titulo,mensaje:data.mensaje,fecha:new Date().toISOString(),leida:false };
  rows.push(notification); await saveRows('notificaciones',rows);
  const [user] = await query('SELECT nombre,correo FROM usuarios WHERE id_usuario=?',[notification.id_cliente]);
  if (user) afterCommit(() => require('./email.service').enviarAlertaNotificacion(user.correo,user.nombre,data.titulo,data.mensaje));
  return notification;
}
module.exports = { listRows, saveRows, nextId, crearNotificacion };
