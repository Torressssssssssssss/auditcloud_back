const { query } = require('../utils/db');
const reportes = require('../services/reportes.service');

// EXISTS evita multiplicar las evidencias cuando hay varios participantes.
const SQL_REPORTE = `SELECT a.id_auditoria, a.objetivo,
  DATE_FORMAT(a.creada_en, '%Y-%m-%d') AS creada_en,
  DATE_FORMAT(a.fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
  est.nombre AS estado, auditora.nombre AS empresa_auditora,
  cliente.nombre AS cliente, empresa.nombre AS empresa, empresa.rfc,
  e.id_evidencia, e.tipo, e.descripcion, e.nombre_archivo,
  DATE_FORMAT(e.creado_en, '%Y-%m-%d') AS fecha_evidencia,
  autor.nombre AS auditor, modulo.nombre AS modulo,
  c.tipo_recurso, c.cantidad, c.unidad_medida,
  DATE_FORMAT(c.fecha_inicio, '%Y-%m-%d') AS consumo_inicio,
  DATE_FORMAT(c.fecha_fin, '%Y-%m-%d') AS consumo_fin
  FROM auditorias a
  JOIN empresas auditora ON auditora.id_empresa = a.id_empresa_auditora
  JOIN usuarios cliente ON cliente.id_usuario = a.id_cliente
  LEFT JOIN empresas empresa ON empresa.id_empresa = cliente.id_empresa
  JOIN estados_auditoria est ON est.id_estado = a.id_estado
  LEFT JOIN evidencias e ON e.id_auditoria = a.id_auditoria
  LEFT JOIN usuarios autor ON autor.id_usuario = e.id_auditor
  LEFT JOIN modulos_ambientales modulo ON modulo.id_modulo = e.id_modulo
  LEFT JOIN consumos_ambientales c ON c.id_evidencia = e.id_evidencia
  WHERE a.id_auditoria = ? AND (
    (? = 1 AND a.id_empresa_auditora = ?) OR
    (? = 2 AND EXISTS (SELECT 1 FROM auditoria_participantes p
      WHERE p.id_auditoria = a.id_auditoria AND p.id_auditor = ?)) OR
    (? = 3 AND a.id_cliente = ?)
  ) ORDER BY e.creado_en, e.id_evidencia`;

async function generarReporte(req, res, next)
{
  const rawId = req.params.id_auditoria;
  const id = Number(rawId);
  if(!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(id) || id > 2147483647)
  {
    return res.status(400).json({ message: 'El id de auditoría debe ser un entero positivo válido.' });
  }
  try
  {
    const { id_rol, id_empresa, id_usuario } = req.user;
    const rows = await query(SQL_REPORTE,
      [id, id_rol, id_empresa ?? null, id_rol, id_usuario, id_rol, id_usuario]);
    // No revela la existencia de auditorías de otros clientes o empresas.
    if(!rows.length)
    {
      return res.status(404).json({ message: 'Auditoría no encontrada o sin acceso.' });
    }
    const hallazgos = rows.filter(row => row.id_evidencia !== null);
    const buffer = await reportes.generarPdfAuditoria(rows[0], hallazgos);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="reporte.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buffer);
  }
  catch(error)
  {
    return next(error);
  }
}

module.exports = { generarReporte };
