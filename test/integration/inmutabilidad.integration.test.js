const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { prepararAplicacion, crearFormulario, secreto } = require('./helpers/aislamiento');

function prepararAuditoria(prueba, estado = 3)
{
  const escenario = prepararAplicacion(prueba);
  Object.assign(escenario.tablas.auditorias[0], { id_estado: estado, id_solicitud_pago: 7, objetivo: 'Objetivo original' });
  escenario.tablas.evidencias = [{ id_evidencia: 70, id_auditoria: 20, id_auditor: 8,
    id_modulo: 1, tipo: 'COMENTARIO', descripcion: 'Evidencia original', creado_en: '2026-01-01' }];
  const ejecutar = escenario.options.execute;
  const consultas = [];
  escenario.options.execute = (sentencia, parametros) =>
  {
    consultas.push(sentencia);
    if(sentencia.includes('JOIN auditoria_participantes')) return [{ id_auditoria: 20 }];
    if(sentencia.includes('FROM consumos_ambientales WHERE')) return [];
    return ejecutar(sentencia, parametros);
  };
  const token = rol => jwt.sign({ id_usuario: rol === 2 ? 8 : rol === 3 ? 9 : 5, id_rol: rol, id_empresa: 11 }, secreto);
  return { ...escenario, token, consultas };
}

const operaciones = [
  ['PATCH', '/api/auditor/auditorias/20/objetivo', 2, { objetivo: 'Objetivo alterado' }],
  ['PUT', '/api/auditor/evidencias/70', 2, { descripcion: 'Evidencia alterada', id_auditoria: 99 }],
  ['DELETE', '/api/auditor/evidencias/70', 2, undefined],
  ['POST', '/api/auditor/evidencias', 2, { id_auditoria: 20, id_modulo: 1, tipo: 'COMENTARIO', descripcion: 'Evidencia nueva' }],
  ['PUT', '/api/supervisor/auditorias/20/estado', 1, { id_estado: 2 }],
  ['PUT', '/api/supervisor/auditorias/20/estado', 1, { id_estado: 3 }],
  ['POST', '/api/supervisor/auditorias/20/modulos', 1, { id_modulo: 2 }],
  ['POST', '/api/supervisor/auditorias/20/asignar', 1, { id_auditor: 8 }],
  ['PUT', '/api/supervisor/auditorias/20/asignar', 1, { id_auditor: 8 }],
  ['DELETE', '/api/supervisor/auditorias/20/asignar', 1, undefined],
  ['POST', '/api/supervisor/solicitudes-pago/7/asignar-auditor', 1, { id_auditor: 8 }],
  ['POST', '/api/timeline/comentarios', 1, { id_auditoria: 20, mensaje: 'Comentario nuevo' }],
  ['POST', '/api/timeline/comentarios', 2, { id_auditoria: 20, mensaje: 'Comentario nuevo' }],
  ['POST', '/api/timeline/comentarios', 3, { id_auditoria: 20, mensaje: 'Comentario nuevo' }]
];

describe('AC-06: expediente finalizado inmutable', { concurrency: false }, () =>
{
  for(const [metodo, destino, rol, cuerpo] of operaciones)
  {
    it(`rechaza ${metodo} ${destino} del rol ${rol}`, async prueba =>
    {
      const escenario = prepararAuditoria(prueba);
      const originales = structuredClone(escenario.tablas);
      const respuesta = await escenario.solicitar(metodo, destino, { token: escenario.token(rol), cuerpo });
      assert.equal(respuesta.estado, 409);
      assert.equal(respuesta.cuerpo.code, 'AUDITORIA_FINALIZADA');
      assert.match(respuesta.cuerpo.message, /solo lectura/);
      assert.deepEqual(escenario.tablas, originales);
      assert.equal(escenario.cambios.length, 0);
      assert.equal(escenario.connection.commit.mock.callCount(), 0);
      assert.equal(escenario.connection.rollback.mock.callCount(), 1);
      // El perfil de la solicitud se verifica antes de entrar en la transacción.
      const consultasEscritura = escenario.consultas.filter(sql => !sql.startsWith('SELECT e.nombre, e.ciudad, e.estado, e.rfc'));
      assert.ok(consultasEscritura[0].includes('FOR UPDATE'));
      assert.equal(escenario.pool.execute.mock.callCount(), destino.includes('/solicitudes-pago/') ? 1 : 0);
    });
  }

  for(const rol of [1, 2])
  {
    it(`rechaza reportes del rol ${rol} antes de subir al almacenamiento o cambiar datos`, async prueba =>
    {
      const escenario = prepararAuditoria(prueba);
      const respuesta = await escenario.solicitar('POST', `/api/${rol === 1 ? 'supervisor' : 'auditor'}/reportes`, {
        ...crearFormulario(), token: escenario.token(rol)
      });
      assert.equal(respuesta.estado, 409);
      assert.equal(respuesta.cuerpo.code, 'AUDITORIA_FINALIZADA');
      assert.equal(escenario.deposito.file.mock.callCount(), 0);
      assert.equal(escenario.tablas.reportes.length, 0);
    });
  }

  it('permite editar el objetivo mientras la auditoría está en proceso', async prueba =>
  {
    const escenario = prepararAuditoria(prueba, 2);
    const respuesta = await escenario.solicitar('PATCH', '/api/auditor/auditorias/20/objetivo', {
      token: escenario.token(2), cuerpo: { objetivo: 'Objetivo actualizado' }
    });
    assert.equal(respuesta.estado, 200);
    assert.equal(escenario.tablas.auditorias[0].objetivo, 'Objetivo actualizado');
    assert.equal(escenario.connection.commit.mock.callCount(), 1);
  });

  for(const metodo of ['PUT', 'DELETE'])
  {
    it(`conserva ${metodo} de una evidencia propia en una auditoría abierta`, async prueba =>
    {
      const escenario = prepararAuditoria(prueba, 2);
      const ejecutar = escenario.options.execute;
      escenario.options.execute = (sentencia, parametros) =>
      {
        if(sentencia === 'SHOW COLUMNS FROM `evidencias`')
        {
          return 'id_evidencia id_auditoria id_auditor id_modulo tipo descripcion creado_en actualizado_en'
            .split(' ').map(campo => ({ Field: campo, Type: 'varchar' }));
        }
        if(sentencia.startsWith('DELETE FROM `evidencias`'))
        {
          escenario.tablas.evidencias = escenario.tablas.evidencias.filter(evidencia => evidencia.id_evidencia !== parametros[0]);
          return { affectedRows: 1 };
        }
        return ejecutar(sentencia, parametros);
      };
      const respuesta = await escenario.solicitar(metodo, '/api/auditor/evidencias/70', {
        token: escenario.token(2), cuerpo: metodo === 'PUT' ? { descripcion: 'Evidencia actualizada' } : undefined
      });
      assert.equal(respuesta.estado, 200);
      if(metodo === 'PUT') assert.equal(escenario.tablas.evidencias[0].descripcion, 'Evidencia actualizada');
      else assert.equal(escenario.tablas.evidencias.length, 0);
      assert.equal(escenario.connection.commit.mock.callCount(), 1);
    });
  }

  it('permite finalizar y después rechaza cualquier intento de reabrir', async prueba =>
  {
    const escenario = prepararAuditoria(prueba, 2);
    escenario.tablas.auditorias[0].id_cliente = null;
    const cerrar = await escenario.solicitar('PUT', '/api/supervisor/auditorias/20/estado', {
      token: escenario.token(1), cuerpo: { id_estado: 3 }
    });
    assert.equal(cerrar.estado, 200);
    const reabrir = await escenario.solicitar('PUT', '/api/supervisor/auditorias/20/estado', {
      token: escenario.token(1), cuerpo: { id_estado: 1 }
    });
    assert.equal(reabrir.estado, 409);
    assert.equal(escenario.tablas.auditorias[0].id_estado, 3);
  });

  it('mantiene las consultas de evidencias de una auditoría finalizada', async prueba =>
  {
    const escenario = prepararAuditoria(prueba);
    const respuesta = await escenario.solicitar('GET', '/api/auditor/evidencias/0', { token: escenario.token(2) });
    assert.equal(respuesta.estado, 200);
    assert.equal(respuesta.cuerpo[0].id_evidencia, 70);
    assert.equal(escenario.consultas.some(sentencia => sentencia.includes('FOR UPDATE')), false);
  });

  it('no revela el estado de auditorías de otra empresa', async prueba =>
  {
    const escenario = prepararAuditoria(prueba);
    const token = jwt.sign({ id_usuario: 5, id_rol: 1, id_empresa: 99 }, secreto);
    const respuesta = await escenario.solicitar('PUT', '/api/supervisor/auditorias/20/estado', { token, cuerpo: { id_estado: 1 } });
    assert.equal(respuesta.estado, 403);
    assert.equal(respuesta.cuerpo.code, 'AUDITORIA_SIN_ACCESO');
    assert.doesNotMatch(respuesta.texto, /FINALIZADA/);
  });
});
