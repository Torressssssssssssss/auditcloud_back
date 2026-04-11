// Prueba tecnica: valida conexion y subida a Firebase Storage.
// Uso: node test-firebase.js

require('dotenv').config();
const admin = require('./utils/firebase');
const { uploadFileToFirebase } = require('./utils/firebaseStorage');

async function testFirebase() {
  console.log('🔥 Probando conexión a Firebase Storage...\n');

  try {
    // 1) Verificar inicializacion
    console.log('1️⃣ Verificando inicialización de Firebase...');
    const bucket = admin.storage().bucket();
    console.log('✅ Firebase inicializado correctamente');
    console.log(`   Bucket: ${bucket.name}\n`);

    // 2) Probar subida
    console.log('2️⃣ Probando subida de archivo...');
    const testContent = Buffer.from('Este es un archivo de prueba para verificar Firebase Storage');
    const testFileName = `test-${Date.now()}.txt`;
    
    const result = await uploadFileToFirebase(
      testContent,
      testFileName,
      'test',
      'text/plain'
    );

    console.log('✅ Archivo subido correctamente');
    console.log(`   URL: ${result.url}`);
    console.log(`   Path: ${result.path}\n`);

    // 3) Verificar existencia
    console.log('3️⃣ Verificando que el archivo existe...');
    const file = bucket.file(result.path);
    const [exists] = await file.exists();
    
    if (exists) {
      console.log('✅ El archivo existe en Firebase Storage\n');
    } else {
      console.log('⚠️ El archivo no se encontró (puede ser un problema de permisos)\n');
    }

    // 4) Limpiar archivo
    console.log('4️⃣ Limpiando archivo de prueba...');
    await file.delete();
    console.log('✅ Archivo de prueba eliminado\n');

    console.log('🎉 ¡Todo funciona correctamente! Firebase Storage está conectado.\n');
    console.log('📝 Siguientes pasos:');
    console.log('   - Los archivos se guardarán en Firebase Storage');
    console.log('   - Evidencias: gs://' + bucket.name + '/evidencias/');
    console.log('   - Reportes: gs://' + bucket.name + '/reportes/');
    console.log('   - Puedes verlos en: https://console.firebase.google.com/project/' + bucket.name.split('.')[0] + '/storage\n');

  } catch (error) {
    console.error('\n❌ Error conectando a Firebase:\n');
    console.error('Mensaje:', error.message);
    console.error('\n💡 Posibles soluciones:');
    
    if (error.message.includes('serviceAccountKey.json')) {
      console.error('   1. Verifica que el archivo serviceAccountKey.json existe en la raíz del proyecto');
      console.error('   2. O configura las variables de entorno en .env');
    } else if (error.message.includes('Permission')) {
      console.error('   1. Verifica que la Service Account tiene rol "Storage Admin"');
      console.error('   2. Ve a Google Cloud Console > IAM & Admin > Service Accounts');
    } else if (error.message.includes('Bucket')) {
      console.error('   1. Verifica que Firebase Storage está habilitado');
      console.error('   2. Ve a Firebase Console > Storage y habilítalo');
    } else {
      console.error('   1. Revisa la configuracion de credenciales');
      console.error('   2. Verifica que las credenciales son correctas');
    }

    console.error('\n📚 Revisa la configuracion de Firebase en .env y credenciales\n');
    process.exit(1);
  }
}

// Ejecutar
testFirebase();

