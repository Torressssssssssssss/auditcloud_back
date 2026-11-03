const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validarConsumo } = require('../../utils/consumos');

const valido = { es_consumo: 'true', tipo_recurso: 'Agua', cantidad: '125.500',
  unidad_medida: 'm3', fecha_inicio: '2024-02-29', fecha_fin: '2024-03-01' };

describe('AC-01: validación de consumos', () =>
{
  it('preserva precisión decimal y admite cero y fechas extremas de MySQL', () =>
  {
    for(const cantidad of ['0', '0.001', '999999999999.999'])
    {
      assert.equal(validarConsumo({ ...valido, cantidad, fecha_inicio: '1000-01-01', fecha_fin: '9999-12-31' }).cantidad, cantidad);
    }
  });
  it('mantiene compatibilidad con evidencias anteriores sin consumo', () =>
  {
    for(const body of [{}, { es_consumo: false }, { es_consumo: 'false' }]) assert.equal(validarConsumo(body), null);
  });
  for(const cantidad of ['-1', '1.0001', '1000000000000', 'NaN', 'Infinity', '1e3', '0x10', '01', '1,5', '', ' 1 ', [], {}, null, true])
  {
    it(`rechaza cantidad fuera de contrato: ${JSON.stringify(cantidad)}`, () =>
    {
      assert.throws(() => validarConsumo({ ...valido, cantidad }), error => error.statusCode === 400 && !!error.fields.cantidad);
    });
  }
  for(const fecha_inicio of ['2025-02-29', '2024-02-30', '2026-04-31', '2026-00-01', '2026-01-00', '0999-12-31', '2026-1-01', '2026-01-01T00:00:00Z'])
  {
    it(`rechaza fecha inexistente o no canónica: ${fecha_inicio}`, () =>
    {
      assert.throws(() => validarConsumo({ ...valido, fecha_inicio }), error => !!error.fields.fecha_inicio);
    });
  }
  it('acepta periodo de un día y rechaza fechas invertidas', () =>
  {
    assert.ok(validarConsumo({ ...valido, fecha_fin: valido.fecha_inicio }));
    assert.throws(() => validarConsumo({ ...valido, fecha_fin: '2024-02-28' }), error => !!error.fields.fecha_fin);
  });
  it('rechaza unidades cruzadas, recursos desconocidos y propiedades heredadas', () =>
  {
    for(const tipo_recurso of ['Gas', 'agua', 'toString', '__proto__', []])
    {
      assert.throws(() => validarConsumo({ ...valido, tipo_recurso }), error => !!error.fields.tipo_recurso);
    }
    assert.throws(() => validarConsumo({ ...valido, unidad_medida: 'kWh' }), error => !!error.fields.unidad_medida);
  });
  it('acepta los cuatro recursos y sus unidades canónicas', () =>
  {
    for(const [tipo_recurso, units] of Object.entries({ Agua: ['L', 'm3'], 'Energía': ['kWh', 'MWh'], Residuos: ['kg', 't'], Emisiones: ['kgCO2e', 'tCO2e'] }))
    {
      for(const unidad_medida of units) assert.ok(validarConsumo({ ...valido, tipo_recurso, unidad_medida }));
    }
  });
  it('no ignora silenciosamente mediciones desactivadas ni flags inválidos', () =>
  {
    for(const es_consumo of [undefined, false, 'false', 'yes', 1, [], {}])
    {
      assert.throws(() => validarConsumo({ ...valido, es_consumo }), error => !!error.fields.es_consumo);
    }
  });
});
