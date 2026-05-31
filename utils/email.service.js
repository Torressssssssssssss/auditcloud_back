// Servicio de correo: envia notificaciones por SMTP (Gmail).
require('dotenv').config(); 
const nodemailer = require('nodemailer');

let transporter = null;
let emailEnabled = false;

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  console.warn('⚠️ Email Service deshabilitado: faltan EMAIL_USER o EMAIL_PASS');
} else {
  try {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      debug: false,
      logger: false
    });

    // Intentar verificar conexión, pero manejar fallos sin detener el backend
    transporter.verify()
      .then(() => {
        emailEnabled = true;
        console.log('✅ Servidor de correos listo para enviar mensajes');
      })
      .catch(() => {
        // No mostrar stacktrace; marcar como deshabilitado
        emailEnabled = false;
        console.warn('⚠️ Email Service deshabilitado: no fue posible verificar el servidor SMTP');
      });
  } catch (err) {
    transporter = null;
    emailEnabled = false;
    console.warn('⚠️ Email Service deshabilitado: error al configurar el transporte SMTP');
  }
}

const enviarNotificacionFinalizacion = async (correoCliente, nombreCliente, nombreEmpresa, nombreReporte) => {
  // Pendiente implementar plantilla de finalizacion
};

const enviarAlertaNotificacion = async (correoDestino, nombreUsuario, titulo, mensaje) => {
  if (!emailEnabled || !transporter) {
    return false;
  }

  try {
    console.log(`[Email Service] Intentando enviar a: ${correoDestino}`);

    const info = await transporter.sendMail({
      from: `"AuditCloud Alertas" <${process.env.EMAIL_USER}>`,
      to: correoDestino,
      subject: `🔔 ${titulo} - AuditCloud`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
          <div style="background-color: #4f46e5; padding: 20px; text-align: center;">
            <h2 style="color: #ffffff; margin: 0;">Nueva Actividad</h2>
          </div>
          
          <div style="padding: 20px;">
            <p>Hola <strong>${nombreUsuario}</strong>,</p>
            <p>Se ha generado una nueva notificación en tu panel:</p>
            
            <div style="background-color: #f3f4f6; padding: 15px; border-left: 4px solid #4f46e5; margin: 20px 0; border-radius: 4px;">
              <h3 style="margin: 0 0 10px 0; color: #1f2937;">${titulo}</h3>
              <p style="margin: 0; color: #4b5563;">${mensaje}</p>
            </div>

            <p style="font-size: 0.9em;">Ingresa a la plataforma para gestionar esta actividad.</p>
          </div>
          
          <div style="background-color: #f9fafb; padding: 10px; text-align: center; border-top: 1px solid #e0e0e0;">
            <p style="font-size: 12px; color: #888; margin: 0;">Este es un mensaje automático, por favor no responder.</p>
          </div>
        </div>
      `
    });
    console.log('📧 Email enviado ID:', info.messageId);
    return true;
  } catch (error) {
    console.warn('❌ Error enviando alerta de correo: se maneja sin detener la app');
    return false;
  }
};

module.exports = { enviarNotificacionFinalizacion, enviarAlertaNotificacion };