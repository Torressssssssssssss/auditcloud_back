const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { prepararAplicacion, secreto } = require('./helpers/aislamiento');

function prepararDashboard(prueba, rol = 1)
{
  const escenario = prepararAplicacion(prueba);
  const consultas = [];
  const ejecutar = escenario.options.execute;
  escenario.options.execute = (sentencia, parametros) =>
  {
    if(sentencia.includes('GROUP BY MONTH(c.fecha_fin)'))
    {
      consultas.push(parametros);
      return [{ mes: 2, tipo_recurso: 'Agua', total: '15.000' }];
    }
    return ejecutar(sentencia, parametros);
  };
  const token = jwt.sign({ id_usuario: 5, id_empresa: 11, id_rol: rol }, secreto, { expiresIn: '1h' });
  return { ...escenario, consultas, token };
}

describe('AC-04: acceso HTTP al dashboard directivo', { concurrency: false }, () =>
{
  it('consulta exclusivamente la empresa del JWT aunque se envíe otra en la URL', async prueba =>
  {
    const escenario = prepararDashboard(prueba);
    const respuesta = await escenario.solicitar('GET', '/api/direccion/consumos-mensuales?anio=2026&id_empresa=99', { token: escenario.token });
    assert.equal(respuesta.estado, 200);
    assert.equal(respuesta.cuerpo.agua[1], '15.000');
    assert.deepEqual(escenario.consultas, [[11, '2026-01-01', '2026-12-31']]);
  });
  it('rechaza a auditores y clientes sin adquirir conexiones SQL', async prueba =>
  {
    const escenario = prepararDashboard(prueba, 2);
    const respuesta = await escenario.solicitar('GET', '/api/direccion/consumos-mensuales', { token: escenario.token });
    assert.equal(respuesta.estado, 403);
    assert.equal(escenario.pool.getConnection.mock.callCount(), 0);
  });
  it('rechaza años fraccionarios o parámetros repetidos', async prueba =>
  {
    const escenario = prepararDashboard(prueba);
    for(const consulta of ['anio=2026.5', 'anio=0', 'anio=2026&anio=2025'])
    {
      const respuesta = await escenario.solicitar('GET', `/api/direccion/consumos-mensuales?${consulta}`, { token: escenario.token });
      assert.equal(respuesta.estado, 400);
    }
    assert.equal(escenario.consultas.length, 0);
  });
  it('no revela detalles internos cuando falla MySQL', async prueba =>
  {
    const escenario = prepararDashboard(prueba);
    escenario.connection.execute.mock.mockImplementation(async () =>
    {
      throw new Error('Detalle privado de SQL');
    });
    const respuesta = await escenario.solicitar('GET', '/api/direccion/consumos-mensuales', { token: escenario.token });
    assert.equal(respuesta.estado, 500);
    assert.doesNotMatch(respuesta.texto, /Detalle privado/);
    assert.equal(escenario.connection.rollback.mock.callCount(), 1);
  });
});
