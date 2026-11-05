const { it } = require('node:test');
const assert = require('node:assert/strict');
const { mockPersistence } = require('./helpers/mysql');

it('incluir el consumo en eventos de evidencia y conservar evidencias sin medición', async prueba =>
{
  const consumo =
  {
    id_evidencia: 31, tipo_recurso: 'Agua', cantidad: '0.000',
    unidad_medida: 'm3', fecha_inicio: '2026-01-01', fecha_fin: '2026-01-31'
  };
  const auditoria =
  {
    id_auditoria: 20, id_empresa_auditora: 11, id_cliente: 9,
    id_solicitud_pago: 4, id_estado: 2, creada_en: '2026-01-01',
    cliente: 'Cliente', empresa_auditora: 'Auditora'
  };
  mockPersistence(prueba,
  {
    execute(sentencia, parametros)
    {
      if(sentencia.includes('FROM auditorias a')) return [auditoria];
      if(sentencia.includes('FROM evidencias e')) return [
        {
          id_evidencia: 31, tipo: 'COMENTARIO', descripcion: 'Lectura de agua',
          autor: 'Auditora', creado_en: '2026-01-31'
        },
        {
          id_evidencia: 32, tipo: 'DOC', descripcion: 'Permiso ambiental',
          autor: 'Auditora', creado_en: '2026-01-31'
        }
      ];
      if(sentencia.includes('FROM consumos_ambientales'))
      {
        assert.deepEqual(parametros, [31, 32]);
        return [consumo];
      }
      if(/FROM (solicitudes_pago|comentarios|reportes|auditoria_participantes|auditoria_modulos)/.test(sentencia)) return [];
      throw new Error(`Consulta inesperada: ${sentencia}`);
    }
  });
  const rutas = ['../../routes/timeline.routes', '../../utils/consumos'];
  for(const nombre of rutas)
  {
    const ruta = require.resolve(nombre);
    const anterior = require.cache[ruta];
    delete require.cache[ruta];
    prueba.after(() =>
    {
      delete require.cache[ruta];
      if(anterior) require.cache[ruta] = anterior;
    });
  }
  const enrutador = require('../../routes/timeline.routes');
  const manejador = enrutador.stack.find(capa => capa.route?.path === '/:idAuditoria').route.stack.at(-1).handle;
  let resultado;
  const respuesta =
  {
    statusCode: 200,
    json(cuerpo)
    {
      resultado = cuerpo;
      return this;
    }
  };
  await manejador(
    {
      method: 'GET', baseUrl: '/api/timeline', params: { idAuditoria: '20' },
      user: { id_rol: 1, id_empresa: 11, id_usuario: 1 }
    }, respuesta, () =>
    {
    });
  assert.equal(respuesta.statusCode, 200);
  assert.deepEqual(resultado.find(evento => evento.id === 'EVI-31').consumo, consumo);
  assert.equal(resultado.find(evento => evento.id === 'EVI-32').consumo, null);
  assert.equal(resultado.find(evento => evento.id === 'EVI-31').descripcion, 'Lectura de agua');
});
