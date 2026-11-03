const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mockPersistence } = require('./helpers/mysql');

function prepararResumen(prueba, filas)
{
  const consultas = [];
  const persistencia = mockPersistence(prueba, {
    execute(sentencia, parametros)
    {
      consultas.push({ sentencia, parametros });
      return filas;
    }
  });
  const ruta = require.resolve('../../services/dashboardDirectivo.service');
  const anterior = require.cache[ruta];
  delete require.cache[ruta];
  prueba.after(() =>
  {
    delete require.cache[ruta];
    if(anterior) require.cache[ruta] = anterior;
  });
  return { ...persistencia, consultas, servicio: require(ruta) };
}

describe('AC-04: consulta mensual del dashboard', { concurrency: false }, () =>
{
  it('rellena los meses sin datos y conserva los decimales del agregado', async prueba =>
  {
    const escenario = prepararResumen(prueba, [
      { mes: 1, tipo_recurso: 'Agua', total: '1.5000000' },
      { mes: 12, tipo_recurso: 'Energía', total: '2000.000' }
    ]);
    const resumen = await escenario.servicio.obtenerConsumosMensuales(11, 2026);
    assert.equal(resumen.agua.length, 12);
    assert.equal(resumen.energia.length, 12);
    assert.equal(resumen.agua[0], '1.5000000');
    assert.equal(resumen.energia[11], '2000.000');
    assert.equal(resumen.agua[1], '0');
    assert.equal(resumen.unidad_agua, 'm3');
    assert.equal(resumen.unidad_energia, 'kWh');
  });
  it('restringe empresa y año con parámetros y normaliza unidades en SQL', async prueba =>
  {
    const escenario = prepararResumen(prueba, []);
    await escenario.servicio.obtenerConsumosMensuales(19, 9999);
    const consulta = escenario.consultas[0];
    assert.deepEqual(consulta.parametros, [19, '9999-01-01', '9999-12-31']);
    assert.match(consulta.sentencia, /a\.id_empresa_auditora=\?/);
    assert.match(consulta.sentencia, /c\.cantidad \/ 1000/);
    assert.match(consulta.sentencia, /c\.cantidad \* 1000/);
    assert.match(consulta.sentencia, /GROUP BY MONTH\(c.fecha_fin\), c.tipo_recurso/);
  });
});
