const { query } = require('../utils/db');

async function obtenerConsumosMensuales(idEmpresa, anio)
{
  const filas = await query(`SELECT MONTH(c.fecha_fin) AS mes, c.tipo_recurso,
    SUM(CASE
      WHEN c.tipo_recurso='Agua' AND c.unidad_medida='L' THEN c.cantidad / 1000
      WHEN c.tipo_recurso='Energía' AND c.unidad_medida='MWh' THEN c.cantidad * 1000
      ELSE c.cantidad END) AS total
    FROM consumos_ambientales c
    JOIN evidencias e ON e.id_evidencia=c.id_evidencia
    JOIN auditorias a ON a.id_auditoria=e.id_auditoria
    WHERE a.id_empresa_auditora=? AND c.tipo_recurso IN ('Agua', 'Energía')
      AND c.fecha_fin >= ? AND c.fecha_fin <= ?
    GROUP BY MONTH(c.fecha_fin), c.tipo_recurso`,
  [idEmpresa, `${anio}-01-01`, `${anio}-12-31`]);
  const agua = Array(12).fill('0');
  const energia = Array(12).fill('0');
  for(const fila of filas)
  {
    const serie = fila.tipo_recurso === 'Agua' ? agua : energia;
    serie[Number(fila.mes) - 1] = String(fila.total);
  }
  return { anio, agua, energia, unidad_agua: 'm3', unidad_energia: 'kWh' };
}

module.exports = { obtenerConsumosMensuales };
