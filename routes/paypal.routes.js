const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const { query } = require('../utils/db');
const { listRows, saveRows } = require('../utils/mysqlStore');
const { authenticate } = require('../utils/auth');
const { ensurePaidAudit } = require('../services/paymentPersistence');
async function accessToken() {
  const {PAYPAL_CLIENT_ID:id,PAYPAL_CLIENT_SECRET:secret,PAYPAL_API:api}=process.env;
  if(!id||!secret||!api) { const error=new Error('PayPal no configurado');error.statusCode=503;throw error; }
  const response=await fetch(`${api}/v1/oauth2/token`,{method:'POST',body:'grant_type=client_credentials',headers:{Authorization:'Basic '+Buffer.from(id+':'+secret).toString('base64')}});
  if(!response.ok)throw new Error('PayPal authentication failed');
  return (await response.json()).access_token;
}
function owns(s,user){return s.id_cliente===user.id_usuario || (s.id_empresa_cliente && s.id_empresa_cliente===user.id_empresa);}
router.post('/create-order',authenticate,async(req,res)=>{
  const [s]=await query('SELECT * FROM solicitudes_pago WHERE id_solicitud=?',[Number(req.body.id_solicitud)]);
  if(!s||s.id_estado===2)return res.status(400).json({message:'Solicitud inválida o ya pagada'});
  if(!owns(s,req.user))return res.status(403).json({message:'No tienes permiso para pagar esta solicitud'});
  const token=await accessToken();
  const response=await fetch(`${process.env.PAYPAL_API}/v2/checkout/orders`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({intent:'CAPTURE',purchase_units:[{reference_id:String(s.id_solicitud),amount:{currency_code:'MXN',value:Number(s.monto).toFixed(2)}}]})});
  const order=await response.json();
  if(!response.ok||!order.id)return res.status(502).json({message:'No se pudo crear orden de PayPal'});
  await query('UPDATE solicitudes_pago SET paypal_order_id=? WHERE id_solicitud=?',[order.id,s.id_solicitud]);
  res.json(order);
});
router.post('/capture-order',authenticate,async(req,res)=>{
  const orderID=String(req.body.orderID||'');
  if(!/^[a-zA-Z0-9-]+$/.test(orderID))return res.status(400).json({message:'Orden inválida'});
  const solicitudes=await listRows('solicitudes_pago');
  const s=solicitudes.find(s=>s.paypal_order_id===orderID);
  if(!s||!owns(s,req.user))return res.status(403).json({message:'Orden no autorizada'});
  if(s.id_estado===2)return res.json({status:'COMPLETED',auditoria:await ensurePaidAudit(s)});
  const token=await accessToken();
  const options={headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}};
  // Read first: a previous capture may have succeeded externally before a local failure.
  let response=await fetch(`${process.env.PAYPAL_API}/v2/checkout/orders/${orderID}`,options);
  if(!response.ok)throw new Error('PayPal order unavailable');
  let order=await response.json();
  if(order.status!=='COMPLETED'){
    response=await fetch(`${process.env.PAYPAL_API}/v2/checkout/orders/${orderID}/capture`,{...options,method:'POST',headers:{...options.headers,'PayPal-Request-Id':`auditcloud-${s.id_solicitud}-${orderID}`}});
    if(!response.ok)throw new Error('PayPal capture failed');
    order=await response.json();
  }
  if(order.status==='COMPLETED'){
    const unit=order.purchase_units?.[0],capture=unit?.payments?.captures?.[0];
    if(Number(unit?.reference_id)!==s.id_solicitud || capture?.status!=='COMPLETED' || capture?.amount?.currency_code!=='MXN' || Math.abs(Number(capture?.amount?.value)-s.monto)>0.001 || !Number.isFinite(Number(capture?.amount?.value)))throw new Error('Payment mismatch');
    s.id_estado=2;s.pagada_en=new Date().toISOString();
    await saveRows('solicitudes_pago',solicitudes);
    return res.json({status:'COMPLETED',auditoria:await ensurePaidAudit(s)});
  }
  res.json(order);
});
module.exports=require('../utils/sqlRouter').transactionalRouter(router);
