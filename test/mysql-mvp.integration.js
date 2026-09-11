// Explicit opt-in: temporary, uniquely tagged fixtures in auditcloud_db, cleaned in finally.
// Payment transport is mocked; any external network access is blocked.
if (process.env.RUN_MYSQL_MVP_TEST !== '1') throw new Error('Set RUN_MYSQL_MVP_TEST=1 explicitly');
require('dotenv').config({quiet:true});
process.env.EMAIL_USER='';process.env.EMAIL_PASS='';process.env.ELASTICSEARCH_ENABLED='false';
process.env.MERCADOPAGO_ACCESS_TOKEN='';process.env.GOOGLE_AUTH_ENABLED='false';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {query,withTransaction,getPool}=require('../utils/db');
const {nextId,listRows,saveRows}=require('../utils/mysqlStore');
const marker='MYSQL_ONLY_TEST_'+Date.now();
const password=crypto.randomBytes(24).toString('hex');
let paypalUnit;
process.env.PAYPAL_API='https://paypal.invalid';process.env.PAYPAL_CLIENT_ID='test';process.env.PAYPAL_CLIENT_SECRET='test';
const paypalFetch=async(url,options={})=>{
 assert.ok(url.startsWith('https://paypal.invalid/'));
 let data;
 if(url.endsWith('/token'))data={access_token:'test-only'};
 else if(url.endsWith('/orders')){paypalUnit=JSON.parse(options.body).purchase_units[0];data={id:marker.replaceAll('_',''),status:'CREATED'};}
 else data={id:marker.replaceAll('_',''),status:'COMPLETED',purchase_units:[{reference_id:paypalUnit.reference_id,payments:{captures:[{status:'COMPLETED',amount:paypalUnit.amount}]}}]};
 return {ok:true,json:async()=>data};
};
require.cache[require.resolve('node-fetch')]={id:require.resolve('node-fetch'),filename:require.resolve('node-fetch'),loaded:true,exports:paypalFetch};
const nativeFetch=global.fetch;
global.fetch=(url,options)=>{
 if(!String(url).startsWith('http://127.0.0.1:'))throw new Error('External network blocked in integration test');
 return nativeFetch(url,options);
};
const dataDir=path.resolve(__dirname,'../data');
const legacyHashes=new Map(fs.readdirSync(dataDir).filter(f=>f.endsWith('.json')).map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(dataDir,f))).digest('hex')]));
const fileRead=fs.promises.readFile.bind(fs.promises),fileWrite=fs.promises.writeFile.bind(fs.promises);
function noLegacy(file){if(String(file).startsWith(dataDir+path.sep)&&String(file).endsWith('.json'))throw new Error('Legacy JSON accessed');}
fs.promises.readFile=async(file,...args)=>{noLegacy(file);return fileRead(file,...args);};
fs.promises.writeFile=async(file,...args)=>{noLegacy(file);return fileWrite(file,...args);};
const app=require('../app');
let server,base,company,supervisor,client,auditor,steps=0;
const uploads=new Set();
async function call(method,url,token,body,expected=200){
 const headers=token?{Authorization:'Bearer '+token}:{};
 if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';
 const response=await fetch(base+url,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
 const text=await response.text();
 assert.equal(response.status,expected,`${method} ${url} status; response omitted`);
 steps++;console.log('PASS',method,url,response.status);
 let result;try{result=JSON.parse(text);}catch{result=text;}
 if(result?.reporte?.url)uploads.add(path.basename(result.reporte.url));
 if(result?.evidencia?.url_archivo)uploads.add(path.basename(result.evidencia.url_archivo));
 return result;
}
async function snapshot(){
 const tables=await query("SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME<>'app_sequences'");
 const hashes={};
 for(const {name} of tables){const rows=await query('SELECT * FROM `'+name+'`');hashes[name]=crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');}
 return hashes;
}
async function cleanup(){
 // Only fixtures carrying this run's random/time marker and their dependent rows.
 const us=await query('SELECT id_usuario FROM usuarios WHERE correo LIKE ?',[marker+'%@example.invalid']);
 const cs=await query('SELECT id_empresa FROM empresas WHERE nombre LIKE ?',[marker+'%']);
 const uid=us.map(x=>x.id_usuario),cid=cs.map(x=>x.id_empresa);
 if(!uid.length&&!cid.length)return;
 const ids=uid.length?uid:[-1];const marks=ids.map(()=>'?').join(',');
 await withTransaction(async()=>{
   const audits=await query(`SELECT id_auditoria FROM auditorias WHERE id_cliente IN (${marks})`,ids);
   const aids=audits.map(a=>a.id_auditoria);const am=aids.map(()=>'?').join(',');
   const convs=await query(`SELECT id_conversacion FROM conversaciones WHERE id_cliente IN (${marks})`,ids);
   if(convs.length)await query(`DELETE FROM mensajes WHERE id_conversacion IN (${convs.map(()=>'?').join(',')})`,convs.map(c=>c.id_conversacion));
   await query(`DELETE FROM conversaciones WHERE id_cliente IN (${marks})`,ids);
   if(aids.length){
     for(const t of ['notificaciones','comentarios','evidencias','reportes','audiencias','auditoria_modulos','auditoria_participantes'])await query(`DELETE FROM ${t} WHERE id_auditoria IN (${am})`,aids);
     await query(`DELETE FROM auditorias WHERE id_auditoria IN (${am})`,aids);
   }
   await query(`DELETE FROM notificaciones WHERE id_cliente IN (${marks})`,ids);
   await query(`DELETE FROM solicitudes_pago WHERE id_cliente IN (${marks})`,ids);
   await query(`DELETE FROM usuarios WHERE id_usuario IN (${marks})`,ids);
   if(cid.length){const cm=cid.map(()=>'?').join(',');await query(`DELETE FROM empresa_modulos WHERE id_empresa IN (${cm})`,cid);await query(`DELETE FROM empresas WHERE id_empresa IN (${cm})`,cid);}
 });
}
(async()=>{
 const before=await snapshot();
 try{
  await withTransaction(async()=>{
   company=await nextId('empresas');supervisor=await nextId('usuarios');
   await query('INSERT INTO empresas (id_empresa,id_tipo_empresa,tipo_auditoria,nombre,pais,activo) VALUES (?,1,\'AMBIENTAL\',?,\'México\',1)',[company,marker+'_auditora']);
   await query('INSERT INTO usuarios (id_usuario,id_empresa,nombre,correo,password_hash,id_rol,activo,creado_en) VALUES (?,?,?,?,?,1,1,UTC_TIMESTAMP())',[supervisor,company,marker+'_supervisor',marker+'_supervisor@example.invalid',password]);
   await query('INSERT INTO empresa_modulos (id_empresa_modulo,id_empresa,id_modulo,registrado_en) VALUES (?,?,1,UTC_TIMESTAMP())',[await nextId('empresa_modulos'),company]);
  });
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+server.address().port;
  await call('POST','/api/auth/login',null,{correo:'invalid@example.invalid',password:'invalid'},401);
  await call('POST','/api/auth/google',null,{token:'invalid'},503);
  const loginSource=fs.readFileSync(path.resolve(__dirname,'../../auditcloud_front/src/app/auth/login/login.component.ts'),'utf8');
  const demoSection=loginSource.match(/demoUsers\s*=\s*\[([\s\S]*?)\];/)[1];
  const demos=[...demoSection.matchAll(/rol:\s*'([^']+)'\s*,\s*correo:\s*'([^']+)'\s*,\s*password:\s*'([^']+)'/g)].map(([,role,correo,secret])=>[role,role==='Cliente'?'cliente@auditcloud.com':correo,secret]);
  assert.equal(demos.length,3);
  for(const [role,correo,secret] of demos){
    const result=await call('POST','/api/auth/login',null,{correo,password:secret});
    assert.equal(result.usuario.id_rol,{Supervisor:1,Auditor:2,Cliente:3}[role]);
    assert.ok(result.usuario.activo);assert.ok(result.usuario.id_empresa);
    console.log('PASS existing DEMO login',role,'credentials unchanged');
  }

  const registration=await call('POST','/api/cliente/registro',null,{nombre:marker+'_client',correo:marker+'_client@example.invalid',password,nombre_empresa:marker+'_cliente',ciudad:'Prueba',estado:'Prueba'},201);
  client=registration.usuario;
  const c=(await call('POST','/api/auth/login',null,{correo:marker+'_client@example.invalid',password})).token;
  const s=(await call('POST','/api/auth/login',null,{correo:marker+'_supervisor@example.invalid',password})).token;
  await call('POST','/api/supervisor/auditores',s,{id_empresa:company,nombre:marker+'_auditor',correo:marker+'_auditor@example.invalid',password},201);
  const auditorLogin=await call('POST','/api/auth/login',null,{correo:marker+'_auditor@example.invalid',password});auditor=auditorLogin.usuario;const a=auditorLogin.token;
  await call('GET','/api/cliente/empresas-auditoras',c);
  await call('GET',`/api/cliente/empresas-auditoras/${company}`,c);
  await call('GET',`/api/supervisor/auditores/${company}`,s);
  await call('PUT',`/api/supervisor/empresa/${company}`,s,{nombre:marker+'_auditora',modulos:[1]});
  const message=await call('POST','/api/cliente/mensajes',c,{id_empresa_auditora:company,contenido:marker+'_hello'},201);
  const [conv]=await query('SELECT id_conversacion FROM conversaciones WHERE id_cliente=? AND tipo_conversacion=\'COMERCIAL\'',[client.id_usuario]);
  await call('GET',`/api/cliente/conversaciones/${client.id_usuario}`,c);
  await call('GET','/api/supervisor/conversaciones',s);
  await call('POST','/api/supervisor/mensajes',s,{id_conversacion:conv.id_conversacion,contenido:marker+'_reply'},201);
  await call('GET',`/api/cliente/mensajes/${conv.id_conversacion}`,c);
  await call('GET',`/api/supervisor/mensajes/${conv.id_conversacion}`,s);
  const payment=(await call('POST','/api/supervisor/solicitudes-pago',s,{id_empresa:client.id_empresa,id_cliente:client.id_usuario,monto:100,concepto:marker},201)).solicitud;
  const [paypalBefore]=await query('SELECT COUNT(*) n FROM solicitudes_pago WHERE id_cliente=?',[client.id_usuario]);
  assert.equal(paypalBefore.n,1);
  await call('GET',`/api/cliente/solicitudes-pago/${client.id_usuario}`,c);
  await call('GET','/api/supervisor/solicitudes-pago',s);
  await call('GET',`/api/mercadopago/estado/${payment.id_solicitud}`,c);
  const order=await call('POST','/api/paypal/create-order',c,{id_solicitud:payment.id_solicitud});
  const paid=await call('POST','/api/paypal/capture-order',c,{orderID:order.id});
  const [paypalAfter]=await query('SELECT COUNT(*) n FROM solicitudes_pago WHERE id_cliente=?',[client.id_usuario]);
  const [paypalRow]=await query('SELECT id_solicitud,id_estado FROM solicitudes_pago WHERE id_solicitud=?',[payment.id_solicitud]);
  assert.equal(paypalAfter.n,paypalBefore.n);
  assert.deepEqual(paypalRow,{id_solicitud:payment.id_solicitud,id_estado:2});
  const retry=await call('POST','/api/paypal/capture-order',c,{orderID:order.id});
  assert.equal(paid.auditoria.id_auditoria,retry.auditoria.id_auditoria);
  const id=paid.auditoria.id_auditoria;
  // Mercado Pago's installed SDK is stubbed; no provider traffic is possible.
  const mp = require('mercadopago');
  process.env.MERCADOPAGO_ACCESS_TOKEN='test-only';
  const mpSolicitud=(await call('POST','/api/supervisor/solicitudes-pago',s,{id_empresa:client.id_empresa,id_cliente:client.id_usuario,monto:100,concepto:marker+'_mp'},201)).solicitud;
  const [mpBefore]=await query('SELECT COUNT(*) n FROM solicitudes_pago WHERE id_cliente=?',[client.id_usuario]);
  mp.Preference.prototype.create=async()=>({id:marker+'_preference',init_point:'https://example.invalid/mock-checkout'});
  mp.Payment.prototype.get=async()=>({id:marker+'_mp_payment',status:'approved',status_detail:'accredited',currency_id:'MXN',transaction_amount:100,external_reference:String(mpSolicitud.id_solicitud),metadata:{id_solicitud_pago:mpSolicitud.id_solicitud}});
  await call('POST','/api/mercadopago/preferencia',c,{id_solicitud:mpSolicitud.id_solicitud});
  await call('POST','/api/mercadopago/confirmar',c,{payment_id:marker+'_mp_payment'});
  const [mpAfter]=await query('SELECT COUNT(*) n FROM solicitudes_pago WHERE id_cliente=?',[client.id_usuario]);
  const [mpRow]=await query('SELECT id_solicitud,id_estado FROM solicitudes_pago WHERE id_solicitud=?',[mpSolicitud.id_solicitud]);
  assert.equal(mpAfter.n,mpBefore.n);
  assert.deepEqual(mpRow,{id_solicitud:mpSolicitud.id_solicitud,id_estado:2});
  await call('POST','/api/mercadopago/confirmar',c,{payment_id:marker+'_mp_payment'});
  await call('GET',`/api/pagos/mercadopago/estado/${mpSolicitud.id_solicitud}`,c);
  const [mpCount]=await query('SELECT COUNT(*) n FROM auditorias WHERE id_solicitud_pago=?',[mpSolicitud.id_solicitud]);assert.equal(mpCount.n,1);
  process.env.MERCADOPAGO_ACCESS_TOKEN='';
  await call('GET','/api/supervisor/clientes-cartera',s);
  await call('POST',`/api/supervisor/solicitudes-pago/${payment.id_solicitud}/asignar-auditor`,s,{id_auditor:auditor.id_usuario});
  await call('POST',`/api/supervisor/auditorias/${id}/modulos`,s,{id_modulo:1},201);
  await call('POST',`/api/supervisor/auditorias/${id}/modulos`,s,{id_modulo:1},409);
  await call('PUT',`/api/supervisor/auditorias/${id}/estado`,s,{id_estado:2});
  await call('GET',`/api/supervisor/auditorias/${company}`,s);
  await call('GET',`/api/auditor/auditorias-asignadas/${auditor.id_usuario}`,a);
  await call('GET',`/api/auditor/auditorias/${id}`,a);
  const [auditConversation]=await query('SELECT id_conversacion FROM conversaciones WHERE id_auditoria=?',[id]);
  await call('GET','/api/auditor/conversaciones',a);
  await call('POST','/api/auditor/mensajes',a,{id_conversacion:auditConversation.id_conversacion,contenido:marker+'_audit_message'},201);
  await call('GET',`/api/auditor/mensajes/${auditConversation.id_conversacion}`,a);
  await call('GET',`/api/cliente/mensajes/${auditConversation.id_conversacion}`,c);
  await call('PATCH',`/api/auditor/auditorias/${id}/objetivo`,a,{objetivo:marker+'_objective'});
  await call('POST','/api/auditor/evidencias',a,{id_auditoria:id,id_modulo:1,tipo:'COMENTARIO',descripcion:marker+'_evidence'},201);
  await call('GET',`/api/auditor/evidencias/${id}`,a);
  const evidenceForm=new FormData();evidenceForm.set('id_auditoria',String(id));evidenceForm.set('id_modulo','1');evidenceForm.set('tipo','DOC');evidenceForm.set('descripcion',marker+'_document');evidenceForm.set('archivo',new Blob(['%PDF-1.4\n% test evidence\n%%EOF'],{type:'application/pdf'}),marker+'_evidence.pdf');
  await call('POST','/api/auditor/evidencias',a,evidenceForm,201);
  await call('POST','/api/timeline/comentarios',c,{id_auditoria:id,mensaje:marker+'_comment'},201);
  const form=new FormData();form.set('id_auditoria',String(id));form.set('nombre',marker+'_report');form.set('archivo',new Blob(['%PDF-1.4\n% temporary integration fixture\n%%EOF'],{type:'application/pdf'}),marker+'.pdf');
  await call('POST','/api/auditor/reportes',a,form,201);
  const [finished]=await query('SELECT id_estado FROM auditorias WHERE id_auditoria=?',[id]);assert.equal(finished.id_estado,3);
  await call('GET','/api/auditor/reportes',a);
  await call('GET',`/api/cliente/reportes/${client.id_usuario}`,c);
  await call('GET',`/api/cliente/auditorias/${client.id_usuario}`,c);
  await call('GET',`/api/cliente/auditorias/${id}/detalle`,c);
  const timeline=await call('GET',`/api/timeline/empresa/${client.id_empresa}`,c);assert.ok(timeline.find(group=>group.id_auditoria===id).items.some(i=>i.tipo==='REPORTE'));
  await call('GET',`/api/timeline/${id}`,c);
  const notifications=await call('GET',`/api/cliente/notificaciones/${client.id_usuario}`,c);
  await call('PUT',`/api/cliente/notificaciones/${client.id_usuario}/leer-todas`,c,{});
  for(const file of uploads){await call('GET','/uploads/'+file,null,null,401);await call('GET','/uploads/'+file,c);}
  // Prove rollback after a successful first write and a subsequent FK failure.
  const [countBefore]=await query('SELECT COUNT(*) n FROM comentarios');
  await assert.rejects(withTransaction(async()=>{
    await query('INSERT INTO comentarios VALUES (?,?,?,?,UTC_TIMESTAMP())',[await nextId('comentarios'),id,client.id_usuario,marker+'_rollback']);
    await query('INSERT INTO comentarios VALUES (?,?,?,?,UTC_TIMESTAMP())',[await nextId('comentarios'),-1,client.id_usuario,marker+'_invalid']);
  }));
  const [countAfter]=await query('SELECT COUNT(*) n FROM comentarios');assert.equal(countBefore.n,countAfter.n);console.log('PASS atomic rollback');
  const results=await Promise.all(Array.from({length:4},(_,i)=>call('POST','/api/cliente/mensajes',c,{id_conversacion:conv.id_conversacion,contenido:marker+'_parallel_'+i},201)));
  assert.equal(new Set(results.map(m=>m.id_mensaje)).size,4);console.log('PASS concurrent IDs/messages');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  // Collect only report/evidence files identified by this run's fixture title.
  const reportFiles=await query('SELECT url FROM reportes WHERE nombre LIKE ? UNION ALL SELECT url_archivo AS url FROM evidencias WHERE descripcion LIKE ? AND url_archivo IS NOT NULL',[marker+'%',marker+'%']);
  reportFiles.forEach(r=>uploads.add(path.basename(r.url)));
  await cleanup();
  const backup=process.env.MYSQL_TEST_ARTIFACT_DIR;
  if(uploads.size&&!backup)throw new Error('MYSQL_TEST_ARTIFACT_DIR required to archive test uploads');
  if(backup){fs.mkdirSync(backup,{recursive:true,mode:0o700});for(const f of uploads){const source=path.join(dataDir,'uploads',f);if(fs.existsSync(source))fs.renameSync(source,path.join(backup,f));}}
  assert.deepEqual(await snapshot(),before,'Existing MySQL rows changed');
  for(const [f,hash] of legacyHashes)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dataDir,f))).digest('hex'),hash,'Legacy JSON changed');
  console.log('PASS cleanup: existing SQL rows and legacy JSON unchanged');
  await getPool().end();
 }
 console.log('PASS MVP integration',steps,'HTTP checks; payment provider mocked');
})().catch(error=>{console.error('FAIL',error.message);process.exitCode=1;});
