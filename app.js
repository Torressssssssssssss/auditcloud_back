// Archivo principal del backend: levanta Express y registra rutas/middlewares.
require('dotenv').config(); 

const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const authRoutes = require('./routes/auth.routes');
const supervisorRoutes = require('./routes/supervisor.routes');
const clienteRoutes = require('./routes/cliente.routes');
const auditorRoutes = require('./routes/auditor.routes');
const paypalRoutes = require('./routes/paypal.routes');
const mercadopagoRoutes = require('./routes/mercadopago.routes');
const timelineRoutes = require('./routes/timeline.routes');
const mysqlRoutes = require('./routes/mysql.routes');
const fragmentosRoutes = require('./routes/fragmentos.routes');
const app = express();
const PORT = Number(process.env.PORT) || 3000;

function normalizeOrigin(origin) {
  return String(origin || '').trim().replace(/\/$/, '');
}

function getAllowedOrigins() {
  const defaultOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:4200',
    'http://192.168.1.243:3000'
  ];

  const frontendUrl = process.env.FRONTEND_URL;
  const envOrigins = frontendUrl
    ? frontendUrl.split(',').map(normalizeOrigin).filter(Boolean)
    : [];

  return [...new Set([...envOrigins, ...defaultOrigins].map(normalizeOrigin).filter(Boolean))];
}

// Middleware base
app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    const allowedOrigins = getAllowedOrigins();
    if (allowedOrigins.includes(normalizeOrigin(origin))) {
      return callback(null, true);
    }

    return callback(new Error(`Origen no permitido por CORS: ${origin}`));
  },
  credentials: true
}));
app.use(express.json());

// Rutas API
app.use('/api/auth', authRoutes);
app.use('/api/supervisor', supervisorRoutes);
app.use('/api/cliente', clienteRoutes);
app.use('/api/auditor', auditorRoutes);
app.use('/api/paypal', paypalRoutes);
app.use('/api/pagos/mercadopago', mercadopagoRoutes);

// Servir uploads directos
app.use('/uploads', async (req, res, next) => {
  try {
    const fileName = req.path.split('/').pop();
    if (!fileName) {
      return next();
    }
    
    const filePath = path.join(__dirname, 'data', 'uploads', fileName);
    
    // Validar que el archivo exista
    try {
      await fs.promises.access(filePath);
    } catch (err) {
      return res.status(404).json({ message: 'Archivo no encontrado' });
    }
    
    // Detectar content-type por extension
    const ext = path.extname(fileName).toLowerCase();
    const contentTypeMap = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif'
    };
    
    const contentType = contentTypeMap[ext] || 'application/octet-stream';
    
    // Enviar archivo
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error sirviendo archivo:', error);
    res.status(500).json({ message: 'Error al procesar el archivo' });
  }
});

app.use('/api/timeline', timelineRoutes); 

// Rutas MySQL (integración paralela)
app.use('/api/mysql', mysqlRoutes);
app.use('/api/fragmentos', fragmentosRoutes);

// Salud
app.get('/', (req, res) => {
  res.send('AuditCloud backend con JSON está vivo 🛰️');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor backend corriendo en http://0.0.0.0:${PORT}`);
});
