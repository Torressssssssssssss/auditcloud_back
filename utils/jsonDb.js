// Utilidad de datos: lee/escribe JSON plano y maneja IDs/notificaciones.
const fs = require('fs');
const path = require('path');
const { enviarAlertaNotificacion } = require('./email.service');

// Carpeta base de datos
const dataDir = path.join(__dirname, '..', 'data');

// Crear carpeta data si no existe
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// Leer JSON; crea archivo vacio si no existe
const readJson = async (filename) => {
  const filePath = path.join(dataDir, filename);
  try {
    if (!fs.existsSync(filePath)) {
      // Crear archivo vacio
      await fs.promises.writeFile(filePath, '[]', 'utf8');
      return [];
    }
    const rawData = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(rawData || '[]');
  } catch (error) {
    console.error(`Error leyendo ${filename}:`, error);
    return [];
  }
};

// Escribe JSON en texto plano
const writeJson = async (filename, data) => {
  const filePath = path.join(dataDir, filename);
  try {
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`Error escribiendo ${filename}:`, error);
    throw error;
  }
};

// Obtiene el siguiente ID
const getNextId = async (filename, idField) => {
  const data = await readJson(filename);
  if (data.length === 0) return 1;
  
  // Convertir IDs a numero
  const ids = data.map(item => Number(item[idField]) || 0);
  const maxId = Math.max(...ids);
  return maxId + 1;
};

// Crea notificacion y dispara correo
async function crearNotificacion(data) {
  try {
    // Guardar notificacion
    const notificaciones = await readJson('notificaciones.json');
    const idNotificacion = await getNextId('notificaciones.json', 'id_notificacion');

    const nueva = {
      id_notificacion: idNotificacion,
      id_cliente: Number(data.id_cliente),
      id_auditoria: data.id_auditoria ? Number(data.id_auditoria) : null,
      tipo: data.tipo,
      titulo: data.titulo,
      mensaje: data.mensaje,
      fecha: new Date().toISOString(),
      leida: false
    };

    notificaciones.push(nueva);
    await writeJson('notificaciones.json', notificaciones);

    // Cargar usuario destino
    const usuarios = await readJson('usuarios.json');
    const usuarioDestino = usuarios.find(u => u.id_usuario === Number(data.id_cliente));

    if (usuarioDestino && usuarioDestino.correo) {
      console.log(`[Notificación] Enviando correo a: ${usuarioDestino.correo}`);
      
      // Enviar correo sin bloquear flujo
      enviarAlertaNotificacion(
        usuarioDestino.correo,
        usuarioDestino.nombre,
        data.titulo,
        data.mensaje
      ).catch(err => console.error('[Notificación] Error al enviar correo:', err));
      
    } else {
      console.warn(`[Notificación] Usuario ${data.id_cliente} no encontrado o sin correo.`);
    }

    return nueva;
  } catch (error) {
    console.error('Error creando notificación:', error);
    // No bloquear flujo principal
    return null; 
  }
}

module.exports = { 
  readJson, 
  writeJson, 
  getNextId, 
  crearNotificacion 
};