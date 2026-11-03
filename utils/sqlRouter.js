// Commit the complete business operation before sending a success response.
const { withTransaction } = require('./db');
const rollbackResponse = Symbol('rollbackResponse');
function publicBody(body) 
{
  if(body === undefined) return body;
  return JSON.parse(JSON.stringify(body, (key, value) =>
    ['password_hash', 'password'].includes(key) ? undefined : value));
}
function transactionalRouter(router, { verificarEscritura } = {})
{
  for(const layer of router.stack) 
{
    if(!layer.route) continue;
    const last = layer.route.stack.at(-1);
    const handler = last.handle;
    if(handler.constructor.name !== 'AsyncFunction') continue;
    last.handle = async function(req, res, next) 
{
      const json = res.json, send = res.send;
      let response;
      res.json = body => 
{
 response = { kind: 'json', body: publicBody(body) }; return res; 
};
      res.send = body => 
{
 response = { kind: 'send', body }; return res; 
};
      try 
{
        await withTransaction(async () => 
{
          if(verificarEscritura) await verificarEscritura(req);
          await handler(req, res, next);
          if(res.statusCode >= 400) throw rollbackResponse;
        }, { write: !['GET', 'HEAD'].includes(req.method) || req.baseUrl.includes('mercadopago') });
      }
 catch(error) 
{
        if(error !== rollbackResponse) 
{
          res.statusCode = error.statusCode || 500;
          const reglaInmutabilidad = ['AUDITORIA_FINALIZADA', 'AUDITORIA_SIN_ACCESO', 'RECURSO_AUDITORIA_INVALIDO'].includes(error.code);
          if(!reglaInmutabilidad) console.error('[MySQL operation failed]', error.code || error.name);
          response = { kind: 'json', body: reglaInmutabilidad
            ? { code: error.code, message: error.message }
            : { message: res.statusCode === 409 ? 'Los datos cambiaron; vuelve a intentar.' : 'No se pudo completar la operación' } };
        }
      }
 finally 
{
        res.json = json; res.send = send;
      }
      if(response && !res.headersSent) res[response.kind](response.body);
    };
  }
  return router;
}
module.exports = { transactionalRouter };
