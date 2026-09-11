const { listRows, saveRows, nextId } = require('../utils/mysqlStore');
// Called only after the provider has authenticated the payment and the amount was checked.
// The route transaction serializes retries, so one request produces at most one audit.
async function ensurePaidAudit(solicitud) {
  if (Number(solicitud.id_estado) !== 2) return null;
  const audits = await listRows('auditorias');
  const existing = audits.find(a => Number(a.id_solicitud_pago) === Number(solicitud.id_solicitud));
  if (existing) return existing;
  const audit = {
    id_auditoria: await nextId('auditorias'),
    id_empresa_auditora: Number(solicitud.id_empresa_auditora || solicitud.id_empresa),
    id_cliente: Number(solicitud.id_cliente), id_solicitud_pago: Number(solicitud.id_solicitud),
    id_estado: 1, monto: Number(solicitud.monto), creada_en: new Date().toISOString(),
    objetivo: solicitud.concepto || null
  };
  audits.push(audit); await saveRows('auditorias', audits);
  return audit;
}
module.exports = { ensurePaidAudit };
