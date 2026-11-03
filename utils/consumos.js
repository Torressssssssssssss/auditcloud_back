const { query } = require('./db');

const UNIDADES_RECURSO = Object.freeze({
  Agua: ['L', 'm3'],
  'Energía': ['kWh', 'MWh'],
  Residuos: ['kg', 't'],
  Emisiones: ['kgCO2e', 'tCO2e']
});
const CAMPOS = ['tipo_recurso', 'cantidad', 'unidad_medida', 'fecha_inicio', 'fecha_fin'];
const CANTIDAD = /^(0|[1-9]\d{0,11})(\.\d{1,3})?$/;

function fechaValida(value)
{
  if(typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Admite JSON y multipart. No convierte decimales a Number: se preserva precisión.
function validarConsumo(body)
{
  const flag = body.es_consumo;
  const errors = {};
  if(![undefined, true, false, 'true', 'false'].includes(flag))
  {
    errors.es_consumo = 'Indica si la evidencia registra un consumo.';
  }
  const enabled = flag === true || flag === 'true';
  if(!enabled)
  {
    if(CAMPOS.some(field => Object.hasOwn(body, field)))
    {
      errors.es_consumo = 'Activa el consumo para enviar mediciones.';
    }
  }
  else
  {
    const { tipo_recurso, cantidad, unidad_medida, fecha_inicio, fecha_fin } = body;
    const units = typeof tipo_recurso === 'string' && Object.hasOwn(UNIDADES_RECURSO, tipo_recurso)
      ? UNIDADES_RECURSO[tipo_recurso] : null;
    if(!units) errors.tipo_recurso = 'Selecciona Agua, Energía, Residuos o Emisiones.';
    if(!units || !units.includes(unidad_medida))
    {
      errors.unidad_medida = 'Selecciona una unidad válida para el recurso.';
    }
    if(!['string', 'number'].includes(typeof cantidad) || !CANTIDAD.test(String(cantidad)))
    {
      errors.cantidad = 'Usa una cantidad entre 0 y 999999999999.999, con hasta 3 decimales y punto decimal.';
    }
    if(!fechaValida(fecha_inicio)) errors.fecha_inicio = 'Indica una fecha inicial real (AAAA-MM-DD, año 1000–9999).';
    if(!fechaValida(fecha_fin)) errors.fecha_fin = 'Indica una fecha final real (AAAA-MM-DD, año 1000–9999).';
    if(!errors.fecha_inicio && !errors.fecha_fin && fecha_fin < fecha_inicio)
    {
      errors.fecha_fin = 'La fecha final no puede ser anterior a la inicial.';
    }
  }
  if(Object.keys(errors).length)
  {
    const error = new Error('Revisa los datos del consumo.');
    error.statusCode = 400;
    error.fields = errors;
    throw error;
  }
  return enabled ? Object.fromEntries(CAMPOS.map(field => [field,
    field === 'cantidad' ? String(body[field]) : body[field]])) : null;
}

async function insertarConsumo(idEvidencia, consumo)
{
  await query(`INSERT INTO consumos_ambientales
    (id_evidencia, tipo_recurso, cantidad, unidad_medida, fecha_inicio, fecha_fin)
    VALUES (?, ?, ?, ?, ?, ?)`, [idEvidencia, ...CAMPOS.map(field => consumo[field])]);
}

async function agregarConsumos(evidencias)
{
  if(!evidencias.length) return [];
  // Se consultan exclusivamente IDs cuyo acceso ya autorizó la ruta.
  const rows = await query(`SELECT id_evidencia, tipo_recurso, cantidad, unidad_medida,
    DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
    DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS fecha_fin
    FROM consumos_ambientales WHERE id_evidencia IN (${evidencias.map(() => '?').join(',')})`,
  evidencias.map(evidencia => evidencia.id_evidencia));
  const byId = new Map(rows.map(row => [row.id_evidencia, row]));
  return evidencias.map(evidencia => ({ ...evidencia, consumo: byId.get(evidencia.id_evidencia) || null }));
}

module.exports = { validarConsumo, insertarConsumo, agregarConsumos };
