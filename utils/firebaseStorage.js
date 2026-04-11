// Helper de Storage: sube archivos a Firebase y retorna URL/ruta.
const admin = require('./firebase');
const { Readable } = require('stream');

// Sube archivo y devuelve URL publica + path
async function uploadFileToFirebase(fileBuffer, fileName, folder = 'uploads', contentType = 'application/octet-stream') {
  try {
    const bucket = admin.storage().bucket();
    
    // Generar nombre unico
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1E9);
    const fileExtension = fileName.split('.').pop();
    const baseName = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_');
    const uniqueFileName = `${timestamp}-${random}-${baseName}.${fileExtension}`;
    
    // Path completo en Storage
    const filePath = `${folder}/${uniqueFileName}`;
    const file = bucket.file(filePath);

    // Crear stream de subida
    const stream = file.createWriteStream({
      metadata: {
        contentType: contentType,
        metadata: {
          originalName: fileName,
          uploadedAt: new Date().toISOString()
        }
      },
      public: true,
    });

    // Pasar buffer a stream
    const bufferStream = new Readable();
    bufferStream.push(fileBuffer);
    bufferStream.push(null);

    // Subir
    return new Promise((resolve, reject) => {
      bufferStream
        .pipe(stream)
        .on('error', (error) => {
          console.error('Error subiendo archivo a Firebase:', error);
          reject(error);
        })
        .on('finish', async () => {
          try {
            // Asegurar acceso publico
            await file.makePublic();
            
            // Construir URL publica
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
            
            resolve({
              url: publicUrl,
              path: filePath,
              fileName: uniqueFileName
            });
          } catch (error) {
            console.error('Error obteniendo URL pública:', error);
            reject(error);
          }
        });
    });
  } catch (error) {
    console.error('Error en uploadFileToFirebase:', error);
    throw error;
  }
}

// Elimina archivo en Storage
async function deleteFileFromFirebase(filePath) {
  try {
    const bucket = admin.storage().bucket();
    const file = bucket.file(filePath);
    
    await file.delete();
    console.log(`Archivo ${filePath} eliminado de Firebase Storage`);
  } catch (error) {
    // Ignorar si no existe
    if (error.code !== 404) {
      console.error('Error eliminando archivo de Firebase:', error);
      throw error;
    }
  }
}

// Genera URL firmada temporal
async function getSignedUrl(filePath, expiresIn = 3600000) {
  try {
    const bucket = admin.storage().bucket();
    const file = bucket.file(filePath);
    
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: new Date(Date.now() + expiresIn)
    });
    
    return url;
  } catch (error) {
    console.error('Error obteniendo URL firmada:', error);
    throw error;
  }
}

module.exports = {
  uploadFileToFirebase,
  deleteFileFromFirebase,
  getSignedUrl
};

