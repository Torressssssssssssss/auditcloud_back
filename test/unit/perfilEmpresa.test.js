const { it: probar } = require('node:test');
const { strict: comprobar } = require('node:assert');
const { mockPersistence: simularPersistencia } = require('./helpers/mysql');

function preparar(prueba, empresas)
{
  const consultas = [];
  simularPersistencia(prueba,
  {
    execute(sentencia, parametros)
    {
      consultas.push({ sentencia, parametros });
      return empresas;
    }
  });
  const ruta = require.resolve('../../middleware/verificarPerfilEmpresa');
  const anterior = require.cache[ruta];
  delete require.cache[ruta];
  prueba.after(() =>
  {
    delete require.cache[ruta];
    if(anterior) require.cache[ruta] = anterior;
  });
  const { verificarPerfilEmpresa } = require(ruta);
  const respuesta =
  {
    codigo: 200,
    status(codigo)
    {
      this.codigo = codigo;
      return this;
    },
    json(datos)
    {
      this.datos = datos;
      return this;
    }
  };
  const solicitud =
  {
    params: { id_auditoria: '7', idSolicitud: '8' },
    body: { id_auditoria: '7' },
    user: { id_rol: 2, id_empresa: 11, id_usuario: 9 }
  };
  const siguiente = prueba.mock.fn();
  return { verificarPerfilEmpresa, respuesta, solicitud, siguiente, consultas };
}

for(const rfc of [null, '', '   '])
{
  probar(`bloquea operación con RFC ${JSON.stringify(rfc)}`, async prueba =>
  {
    const escenario = preparar(prueba, [{ nombre: 'Empresa', ciudad: 'Ciudad', estado: 'Estado', rfc }]);
    await escenario.verificarPerfilEmpresa('auditoria')(escenario.solicitud, escenario.respuesta, escenario.siguiente);
    comprobar.equal(escenario.respuesta.codigo, 403);
    comprobar.equal(escenario.respuesta.datos.code, 'PERFIL_EMPRESA_INCOMPLETO');
    comprobar.deepEqual(escenario.respuesta.datos.campos, ['rfc']);
    comprobar.equal(escenario.siguiente.mock.callCount(), 0);
  });
}

probar('permite RFC extranjero y limita la consulta al acceso a la auditoría', async prueba =>
{
  const escenario = preparar(prueba, [{ nombre: 'Empresa', ciudad: 'Ciudad', estado: 'Estado', rfc: 'XEXX010101000' }]);
  await escenario.verificarPerfilEmpresa('auditoria')(escenario.solicitud, escenario.respuesta, escenario.siguiente);
  comprobar.equal(escenario.siguiente.mock.callCount(), 1);
  comprobar.deepEqual(escenario.consultas[0].parametros, [7, 2, 11, 2, 9, 2, 9]);
  comprobar.match(escenario.consultas[0].sentencia, /auditoria_participantes/);
});

probar('verifica la empresa auditada desde la solicitud de pago del supervisor', async prueba =>
{
  const escenario = preparar(prueba, [{ nombre: 'Empresa', ciudad: null, estado: 'Estado', rfc: 'XEXX010101000' }]);
  await escenario.verificarPerfilEmpresa('solicitud')(escenario.solicitud, escenario.respuesta, escenario.siguiente);
  comprobar.equal(escenario.respuesta.codigo, 403);
  comprobar.deepEqual(escenario.respuesta.datos.campos, ['ciudad']);
  comprobar.deepEqual(escenario.consultas[0].parametros, [8, 11]);
});

probar('no revela el perfil de una auditoría sin acceso', async prueba =>
{
  const escenario = preparar(prueba, []);
  await escenario.verificarPerfilEmpresa('auditoria')(escenario.solicitud, escenario.respuesta, escenario.siguiente);
  comprobar.equal(escenario.respuesta.codigo, 404);
  comprobar.equal(escenario.siguiente.mock.callCount(), 0);
});
