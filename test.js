// Prueba tecnica: envia un correo de prueba usando SMTP configurado.
require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function main() {
  try {
    console.log('Intentando enviar correo de prueba...');
    console.log('Usuario:', process.env.EMAIL_USER);
    // Solo validar que exista password
    console.log('Pass existe:', process.env.EMAIL_PASS ? 'SI' : 'NO');

    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER, // Enviar a la misma cuenta
      subject: "Prueba de SMTP AuditCloud",
      text: "Si lees esto, la configuración es correcta.",
    });

    console.log("Mensaje enviado: %s", info.messageId);
  } catch (error) {
    console.error("Error:", error);
  }
}

main();