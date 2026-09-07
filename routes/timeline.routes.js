const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { nextId } = require('../utils/mysqlStore');
const { authenticate } = require('../utils/auth');
async function allowedAudit(id, user) {
  const [audit] = await query(`SELECT a.* FROM auditorias a WHERE a.id_auditoria=? AND (
    (?=3 AND a.id_cliente=?) OR (?=1 AND a.id_empresa_auditora=?) OR
    (?=2 AND EXISTS(SELECT 1 FROM auditoria_participantes ap WHERE ap.id_auditoria=a.id_auditoria AND ap.id_auditor=?)))`,
  [id,user.id_rol,user.id_usuario,user.id_rol,user.id_empresa,user.id_rol,user.id_usuario]);
  return audit;
}
async function itemsFor(id) {
  const evidence = await query(`SELECT e.*,u.nombre autor FROM evidencias e JOIN usuarios u ON u.id_usuario=e.id_auditor WHERE e.id_auditoria=?`,[id]);
  const comments = await query(`SELECT c.*,u.nombre autor FROM comentarios c JOIN usuarios u ON u.id_usuario=c.id_usuario WHERE c.id_auditoria=?`,[id]);
  const reports = await query(`SELECT r.*,u.nombre autor FROM reportes r JOIN usuarios u ON u.id_usuario=r.creado_por WHERE r.id_auditoria=?`,[id]);
  return [
    ...evidence.map(e=>({id:`EVI-${e.id_evidencia}`,tipo:'EVIDENCIA',subtipo:e.tipo,descripcion:e.descripcion,url:e.url_archivo,nombre_archivo:e.nombre_archivo,autor:e.autor,fecha:e.creado_en})),
    ...comments.map(c=>({id:`COM-${c.id_comentario}`,tipo:'COMENTARIO',descripcion:c.mensaje,autor:c.autor,fecha:c.creado_en})),
    ...reports.map(r=>({id:`REP-${r.id_reporte}`,tipo:'REPORTE',subtipo:r.tipo,descripcion:r.nombre,url:r.url,nombre_archivo:r.nombre_archivo,autor:r.autor,fecha:r.fecha_creacion}))
  ].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
}
router.get('/empresa/:idEmpresa', authenticate, async(req,res)=>{
  const id=Number(req.params.idEmpresa);
  if(id!==Number(req.user.id_empresa))return res.status(403).json({message:'Acceso denegado'});
  const audits=await query(`SELECT a.* FROM auditorias a JOIN usuarios u ON u.id_usuario=a.id_cliente WHERE
    (?=3 AND u.id_empresa=? AND a.id_cliente=?) OR (?=1 AND a.id_empresa_auditora=?) OR
    (?=2 AND EXISTS(SELECT 1 FROM auditoria_participantes p WHERE p.id_auditoria=a.id_auditoria AND p.id_auditor=?)) ORDER BY a.creada_en DESC`,
    [req.user.id_rol,id,req.user.id_usuario,req.user.id_rol,id,req.user.id_rol,req.user.id_usuario]);
  const result=[];
  for(const a of audits)result.push({id_auditoria:a.id_auditoria,fecha_creacion:a.creada_en,estado:a.id_estado,items:await itemsFor(a.id_auditoria)});
  res.json(result);
});
router.get('/:idAuditoria',authenticate,async(req,res)=>{
  const audit=await allowedAudit(Number(req.params.idAuditoria),req.user);
  if(!audit)return res.status(403).json({message:'Acceso denegado a esta bitácora'});
  res.json(await itemsFor(audit.id_auditoria));
});
router.post('/comentarios',authenticate,async(req,res)=>{
  const id=Number(req.body.id_auditoria),mensaje=String(req.body.mensaje||'').trim();
  if(!id||!mensaje)return res.status(400).json({message:'Faltan datos'});
  if(!await allowedAudit(id,req.user))return res.status(403).json({message:'Acceso denegado'});
  const comment={id_comentario:await nextId('comentarios'),id_auditoria:id,id_usuario:req.user.id_usuario,mensaje,creado_en:new Date().toISOString()};
  await query('INSERT INTO comentarios (id_comentario,id_auditoria,id_usuario,mensaje,creado_en) VALUES (?,?,?,?,UTC_TIMESTAMP())',[comment.id_comentario,id,req.user.id_usuario,mensaje]);
  res.status(201).json(comment);
});
module.exports=require('../utils/sqlRouter').transactionalRouter(router);
