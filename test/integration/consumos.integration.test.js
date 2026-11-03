const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { prepararAplicacion, secreto } = require('./helpers/aislamiento');

const body = { id_auditoria: '20', id_modulo: '1', tipo: 'COMENTARIO',
  descripcion: 'Lectura del contador de agua', es_consumo: 'true',
  tipo_recurso: 'Agua', cantidad: '123456789012.123', unidad_medida: 'm3',
  fecha_inicio: '2026-01-01', fecha_fin: '2026-01-31' };
const token = (role = 2) => jwt.sign({ id_usuario: 8, id_empresa: 11, id_rol: role }, secreto);

function fixture(t, { assigned = true, insertError = false } = {})
{
  const f = prepararAplicacion(t);
  f.tablas.evidencias = [];
  f.tablas.auditorias[0].id_cliente = null;
  f.consumos = [];
  const previous = f.options.execute;
  f.options.execute = (sql, params) =>
  {
    if(sql.includes('JOIN auditoria_participantes')) return assigned ? [{ id_auditoria: 20 }] : [];
    if(sql.startsWith('SELECT id_modulo FROM auditoria_modulos')) return [{ id_modulo: 1 }];
    if(sql === 'SHOW COLUMNS FROM `evidencias`')
    {
      return 'id_evidencia id_auditoria id_modulo id_auditor tipo descripcion nombre_archivo url_archivo creado_en'
        .split(' ').map(Field => ({ Field, Type: 'varchar' }));
    }
    if(sql.startsWith('INSERT INTO consumos_ambientales'))
    {
      if(insertError) throw Object.assign(new Error('SQL privado'), { code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
      f.consumos.push(Object.fromEntries(['id_evidencia', 'tipo_recurso', 'cantidad', 'unidad_medida', 'fecha_inicio', 'fecha_fin'].map((key, i) => [key, params[i]])));
      return { affectedRows: 1 };
    }
    if(sql.includes('FROM consumos_ambientales WHERE')) return f.consumos.filter(c => params.includes(c.id_evidencia));
    return previous(sql, params);
  };
  return f;
}

describe('AC-01: Express, JWT y transacciones con MySQL simulado', { concurrency: false }, () =>
{
  it('crea evidencia y medición en una sola conexión y las recupera por GET', async t =>
  {
    const f = fixture(t);
    const result = await f.solicitar('POST', '/api/auditor/evidencias', { token: token(), cuerpo: body });
    assert.equal(result.estado, 201);
    assert.equal(result.cuerpo.evidencia.consumo.cantidad, body.cantidad);
    assert.equal(f.tablas.evidencias.length, 1);
    assert.equal(f.consumos.length, 1);
    assert.equal(f.connection.commit.mock.callCount(), 1);
    assert.equal(f.connection.rollback.mock.callCount(), 0);
    assert.equal(f.pool.execute.mock.callCount(), 0);
    const read = await f.solicitar('GET', '/api/auditor/evidencias/0', { token: token() });
    assert.equal(read.estado, 200);
    assert.deepEqual(read.cuerpo[0].consumo, f.consumos[0]);
  });
  it('procesa los campos multipart reales del formulario Angular', async t =>
  {
    const f = fixture(t);
    const boundary = 'ac01-boundary';
    const contenido = Object.entries(body).map(([key, value]) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join('') + `--${boundary}--\r\n`;
    const result = await f.solicitar('POST', '/api/auditor/evidencias', {
      token: token(), contenido, tipo: `multipart/form-data; boundary=${boundary}`
    });
    assert.equal(result.estado, 201);
    assert.equal(f.consumos[0].tipo_recurso, 'Agua');
  });
  it('revierte toda la operación si falla la inserción del consumo y no filtra SQL', async t =>
  {
    const f = fixture(t, { insertError: true });
    const result = await f.solicitar('POST', '/api/auditor/evidencias', { token: token(), cuerpo: body });
    assert.equal(result.estado, 500);
    assert.equal(f.connection.commit.mock.callCount(), 0);
    assert.equal(f.connection.rollback.mock.callCount(), 1);
    assert.equal(f.connection.release.mock.callCount(), 1);
    assert.doesNotMatch(result.texto, /SQL privado|INSERT|ER_CHECK/);
  });
  it('rechaza una medición inválida antes de insertar la evidencia', async t =>
  {
    const f = fixture(t);
    const result = await f.solicitar('POST', '/api/auditor/evidencias', {
      token: token(), cuerpo: { ...body, cantidad: '-5', fecha_fin: '2025-02-29' }
    });
    assert.equal(result.estado, 400);
    assert.ok(result.cuerpo.errors.cantidad);
    assert.ok(result.cuerpo.errors.fecha_fin);
    assert.equal(f.tablas.evidencias.length, 0);
    assert.equal(f.consumos.length, 0);
  });
  it('no permite crear consumos en auditorías sin asignación', async t =>
  {
    const f = fixture(t, { assigned: false });
    const result = await f.solicitar('POST', '/api/auditor/evidencias', { token: token(), cuerpo: body });
    assert.equal(result.estado, 403);
    assert.equal(f.tablas.evidencias.length, 0);
    assert.equal(f.consumos.length, 0);
  });
  it('bloquea a clientes antes de adquirir una conexión SQL', async t =>
  {
    const f = fixture(t);
    const result = await f.solicitar('POST', '/api/auditor/evidencias', { token: token(3), cuerpo: body });
    assert.equal(result.estado, 403);
    assert.equal(f.pool.getConnection.mock.callCount(), 0);
  });
  it('conserva el alta de evidencias no cuantificables', async t =>
  {
    const f = fixture(t);
    const result = await f.solicitar('POST', '/api/auditor/evidencias', {
      token: token(), cuerpo: { id_auditoria: 20, id_modulo: 1, tipo: 'COMENTARIO', descripcion: 'Nota sin medición' }
    });
    assert.equal(result.estado, 201);
    assert.equal(result.cuerpo.evidencia.consumo, null);
    assert.equal(f.consumos.length, 0);
    assert.equal(f.connection.commit.mock.callCount(), 1);
  });
  it('publica nuevo_consumo solo al confirmar la evidencia y la medición', async prueba =>
  {
    const escenario = fixture(prueba);
    const emitir = prueba.mock.fn(() =>
    {
      assert.equal(escenario.connection.commit.mock.callCount(), 1);
    });
    const sala = prueba.mock.fn(() => ({ emit: emitir }));
    require('../../app').set('socketio', { to: sala });
    const respuesta = await escenario.solicitar('POST', '/api/auditor/evidencias', { token: token(), cuerpo: body });
    await new Promise(resolver => setImmediate(resolver));
    assert.equal(respuesta.estado, 201);
    assert.equal(emitir.mock.callCount(), 1);
    assert.deepEqual(sala.mock.calls[0].arguments, ['direccion:empresa:11']);
    const [nombre, consumo] = emitir.mock.calls[0].arguments;
    assert.equal(nombre, 'nuevo_consumo');
    assert.equal(consumo.cantidad, body.cantidad);
    assert.equal(consumo.id_auditoria, 20);
  });
  it('no publica nuevo_consumo cuando falla el commit', async prueba =>
  {
    const escenario = fixture(prueba);
    const emitir = prueba.mock.fn();
    require('../../app').set('socketio', { to: () => ({ emit: emitir }) });
    escenario.connection.commit.mock.mockImplementation(async () =>
    {
      throw new Error('Fallo de commit simulado');
    });
    const respuesta = await escenario.solicitar('POST', '/api/auditor/evidencias', { token: token(), cuerpo: body });
    await new Promise(resolver => setImmediate(resolver));
    assert.equal(respuesta.estado, 500);
    assert.equal(emitir.mock.callCount(), 0);
    assert.equal(escenario.connection.rollback.mock.callCount(), 1);
  });
});
