const { query: consultar } = require('../utils/db');
const { unlink: eliminarArchivo } = require('node:fs/promises');

function camposPendientes(empresa)
{
  return ['nombre', 'ciudad', 'estado', 'rfc'].filter(campo =>
  {
    return typeof empresa?.[campo] !== 'string' || !empresa[campo].trim();
  });
}

// Verifica la empresa del cliente auditado, conservando el alcance de acceso del usuario.
function verificarPerfilEmpresa(origen)
{
  return async (solicitud, respuesta, siguiente) =>
  {
    try
    {
      const identificador = origen === 'solicitud'
        ? solicitud.params.idSolicitud
        : solicitud.params.id_auditoria ?? solicitud.body?.id_auditoria;
      const numero = Number(identificador);
      if(!Number.isSafeInteger(numero) || numero <= 0)
      {
        return respuesta.status(400).json({ message: 'Identificador inválido.' });
      }
      const { id_rol: rol, id_empresa: empresa, id_usuario: usuario } = solicitud.user;
      const sentencia = origen === 'solicitud'
        ? `SELECT e.nombre, e.ciudad, e.estado, e.rfc FROM solicitudes_pago s
           LEFT JOIN usuarios c ON c.id_usuario = s.id_cliente
           LEFT JOIN empresas e ON e.id_empresa = c.id_empresa
           WHERE s.id_solicitud = ? AND COALESCE(s.id_empresa_auditora, s.id_empresa) = ?`
        : `SELECT e.nombre, e.ciudad, e.estado, e.rfc FROM auditorias a
           LEFT JOIN usuarios c ON c.id_usuario = a.id_cliente
           LEFT JOIN empresas e ON e.id_empresa = c.id_empresa
           WHERE a.id_auditoria = ? AND (
             (? = 1 AND a.id_empresa_auditora = ?) OR
             (? = 2 AND EXISTS (SELECT 1 FROM auditoria_participantes p
               WHERE p.id_auditoria = a.id_auditoria AND p.id_auditor = ?)) OR
             (? = 3 AND a.id_cliente = ?))`;
      const parametros = origen === 'solicitud'
        ? [numero, empresa ?? null]
        : [numero, rol, empresa ?? null, rol, usuario, rol, usuario];
      const empresas = await consultar(sentencia, parametros);
      if(!empresas.length)
      {
        if(solicitud.file?.path) await eliminarArchivo(solicitud.file.path);
        return respuesta.status(404).json({ message: 'Recurso no encontrado o sin acceso.' });
      }
      const pendientes = camposPendientes(empresas[0]);
      if(pendientes.length)
      {
        if(solicitud.file?.path) await eliminarArchivo(solicitud.file.path);
        return respuesta.status(403).json({
          code: 'PERFIL_EMPRESA_INCOMPLETO',
          message: 'Completa primero el perfil de la empresa auditada, incluyendo su RFC, en Perfil. Si pertenece a otro cliente, solicita que lo complete. Para empresas extranjeras se admite XEXX010101000.',
          campos: pendientes
        });
      }
      return siguiente();
    }
    catch(error)
    {
      return siguiente(error);
    }
  };
}

module.exports = { verificarPerfilEmpresa, camposPendientes };
