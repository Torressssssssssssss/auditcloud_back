// Inicializa Firebase Admin para usar Storage desde el backend.
const admin = require('firebase-admin');
require('dotenv').config();

// Inicializar con JSON en variable de entorno
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  // Credenciales en variable de entorno
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`
  });
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  // Credenciales por ruta de archivo
  const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`
  });
} else {
  // Fallback local con serviceAccountKey.json
  try {
    const serviceAccount = require('../serviceAccountKey.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`
    });
  } catch (error) {
    console.error('❌ Error inicializando Firebase:', error.message);
    console.error('💡 Asegúrate de tener configuradas las credenciales de Firebase');
    // Permitir arranque sin Firebase
  }
}

module.exports = admin;

