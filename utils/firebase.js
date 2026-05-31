// Inicializa Firebase Admin para usar Storage desde el backend de forma segura (opcional).
const admin = require('firebase-admin');
const fs = require('fs');
require('dotenv').config();

let firebaseEnabled = false;

try {
  let serviceAccount = null;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH && fs.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
    serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
  } else if (fs.existsSync(__dirname + '/../serviceAccountKey.json')) {
    serviceAccount = require('../serviceAccountKey.json');
  }

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`
    });
    firebaseEnabled = true;
    console.log('✅ Firebase Admin inicializado');
  } else {
    console.warn('⚠️ Firebase deshabilitado: no hay credenciales configuradas');
  }
} catch (err) {
  // No mostrar stacktrace; solo advertir que Firebase quedó deshabilitado.
  console.warn('⚠️ Firebase deshabilitado: no hay credenciales configuradas');
  firebaseEnabled = false;
}

// Exponer bandera para consumir desde otras partes del app
admin.firebaseEnabled = firebaseEnabled;

module.exports = admin;

