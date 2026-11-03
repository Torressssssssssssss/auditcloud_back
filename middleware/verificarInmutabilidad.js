const fs = require('node:fs/promises');
const { query, transactionContext } = require('../utils/db');

const MENSAJE_FINALIZADA = 'La auditoría está FINALIZADA y es de solo lectura. No se permiten modificaciones.';

function recursoAuditoria(solicitud)
{
  const ruta = solicitud.route.path;
  if(solicitud.params.idEvidencia !== undefined)
  {
    return { identificador: solicitud.params.idEvidencia, relacion: 'JOIN evidencias e ON e.id_auditoria=a.id_auditoria', condicion: 'e.id_evidencia=?' };
  }
  if(ruta.startsWith('/auditorias/'))
  {
    return { identificador: solicitud.params.idAuditoria ?? solicitud.params.id, relacion: '', condicion: 'a.id_auditoria=?' };
  }
  if(['/evidencias', '/reportes', '/comentarios'].includes(ruta) && solicitud.body?.id_auditoria !== undefined)
  {
    return { identificador: solicitud.body.id_auditoria, relacion: '', condicion: 'a.id_auditoria=?' };
  }
  if(ruta === '/solicitudes-pago/:idSolicitud/asignar-auditor')
  {
    return { identificador: solicitud.params.idSolicitud, relacion: '', condicion: 'a.id_solicitud_pago=?', opcional: true };
  }
  return null;
}

async function verificarInmutabilidad(solicitud)
{
  if(['GET', 'HEAD', 'OPTIONS'].includes(solicitud.method)) return;
  const recurso = recursoAuditoria(solicitud);
  if(!recurso) return;
  if(!transactionContext.getStore()?.write) throw new Error('La inmutabilidad requiere una transacción de escritura.');
  if(!['string', 'number'].includes(typeof recurso.identificador) ||
    !/^[1-9]\d*$/.test(String(recurso.identificador)) || Number(recurso.identificador) > 2147483647)
  {
    throw Object.assign(new Error('Identificador de auditoría o evidencia inválido.'), { statusCode: 400, code: 'RECURSO_AUDITORIA_INVALIDO' });
  }
  const usuario = solicitud.user;
  const propietario = usuario.id_rol === 3 ? 'a.id_cliente' : 'a.id_empresa_auditora';
  const idPropietario = usuario.id_rol === 3 ? usuario.id_usuario : usuario.id_empresa;
  const [auditoria] = await query(`SELECT a.id_auditoria, a.id_estado FROM auditorias a
    ${recurso.relacion} WHERE ${recurso.condicion} AND ${propietario}=? FOR UPDATE`,
  [Number(recurso.identificador), idPropietario]);
  if(!auditoria)
  {
    if(recurso.opcional) return;
    throw Object.assign(new Error('Auditoría no encontrada o sin permisos.'), { statusCode: 403, code: 'AUDITORIA_SIN_ACCESO' });
  }
  if(Number(auditoria.id_estado) === 3)
  {
    if(solicitud.file?.path)
    {
      await fs.unlink(solicitud.file.path).catch(error =>
      {
        if(error.code !== 'ENOENT') console.error('No se pudo retirar el archivo rechazado:', error.code);
      });
    }
    throw Object.assign(new Error(MENSAJE_FINALIZADA), { statusCode: 409, code: 'AUDITORIA_FINALIZADA' });
  }
}

module.exports = { verificarInmutabilidad, MENSAJE_FINALIZADA };
