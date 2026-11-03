const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { prepararAplicacion, secreto } = require('./helpers/aislamiento');

const token = (rol = 2) => jwt.sign({ id_usuario: 8, id_empresa: 11, id_rol: rol }, secreto);
const auditoria = { id_auditoria: 20, empresa: 'Empresa demo', estado: 'EN_PROCESO' };

function fixture(t, rows = [{ ...auditoria, id_evidencia: null }])
{
  const f = prepararAplicacion(t);
  const consultas = [];
  f.options.execute = (sql, params) =>
  {
    consultas.push({ sql, params });
    return rows;
  };
  const pdf = Buffer.from('%PDF-1.3\nPDF simulado para verificar el transporte HTTP\n%%EOF');
  const generar = t.mock.method(require('../../services/reportes.service'), 'generarPdfAuditoria', async () => pdf);
  return { ...f, consultas, generar, pdf };
}

describe('AC-05: descarga de reportes con Express y JWT', { concurrency: false }, () =>
{
  it('requiere autenticación y un rol permitido antes de consultar MySQL', async t =>
  {
    const f = fixture(t);
    assert.equal((await f.solicitar('GET', '/api/reportes/generar/20')).estado, 401);
    assert.equal((await f.solicitar('GET', '/api/reportes/generar/20', { token: token(99) })).estado, 403);
    assert.equal(f.consultas.length, 0);
  });
  it('rechaza IDs inválidos sin consultar SQL', async t =>
  {
    const f = fixture(t);
    for(const id of ['0', '-1', '1.5', 'abc', '20%20OR%201=1', '2147483648'])
    {
      assert.equal((await f.solicitar('GET', `/api/reportes/generar/${id}`, { token: token() })).estado, 400);
    }
    assert.equal(f.consultas.length, 0);
  });
  it('devuelve 404 sin generar PDF si no existe o no tiene acceso', async t =>
  {
    const f = fixture(t, []);
    const result = await f.solicitar('GET', '/api/reportes/generar/20', { token: token() });
    assert.equal(result.estado, 404);
    assert.equal(f.generar.mock.callCount(), 0);
  });
  for(const rol of [1, 2, 3]) it(`descarga PDF para el rol ${rol} con consulta parametrizada`, async t =>
  {
    const f = fixture(t);
    const result = await f.solicitar('GET', '/api/reportes/generar/20', { token: token(rol) });
    assert.equal(result.estado, 200);
    assert.equal(result.tipo, 'application/pdf');
    assert.equal(result.headers['content-disposition'], 'attachment; filename="reporte.pdf"');
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(Number(result.headers['content-length']), f.pdf.length);
    assert.equal(result.texto, f.pdf.toString());
    assert.deepEqual(f.consultas[0].params, [20, rol, 11, rol, 8, rol, 8]);
    assert.match(f.consultas[0].sql, /LEFT JOIN evidencias/);
    assert.match(f.consultas[0].sql, /LEFT JOIN consumos_ambientales/);
    assert.match(f.consultas[0].sql, /EXISTS \(SELECT 1 FROM auditoria_participantes/);
    assert.deepEqual(f.generar.mock.calls[0].arguments, [{ ...auditoria, id_evidencia: null }, []]);
  });
  it('entrega todas las evidencias al generador, incluido un consumo de cantidad cero', async t =>
  {
    const rows = [
      { ...auditoria, id_evidencia: 1, descripcion: 'Lectura', cantidad: '0.000', tipo_recurso: 'Agua' },
      { ...auditoria, id_evidencia: 2, descripcion: 'Observación', tipo_recurso: null }
    ];
    const f = fixture(t, rows);
    assert.equal((await f.solicitar('GET', '/api/reportes/generar/20', { token: token() })).estado, 200);
    assert.deepEqual(f.generar.mock.calls[0].arguments, [rows[0], rows]);
  });
  for(const tipo of ['SQL', 'PDF']) it(`maneja un fallo de ${tipo} sin exponer detalles internos`, async t =>
  {
    const f = fixture(t);
    const fallar = async () =>
    {
      throw new Error('Detalle privado de SQL o PDF');
    };
    if(tipo === 'SQL') f.options.execute = fallar;
    else f.generar.mock.mockImplementation(fallar);
    const result = await f.solicitar('GET', '/api/reportes/generar/20', { token: token() });
    assert.equal(result.estado, 500);
    assert.match(result.tipo, /application\/json/);
    assert.doesNotMatch(result.texto, /Detalle privado/);
  });
});
