const limitarPeticiones = require('express-rate-limit');

function configurarProteccionHttp(aplicacion)
{
  aplicacion.set('trust proxy', 'loopback');
  // Las peticiones simuladas de integración pueden no tener una IP de conexión.
  if(process.env.NODE_ENV === 'test')
  {
    return;
  }
  const proteccionGeneral = limitarPeticiones(
  {
    windowMs: 15 * 60 * 1000,
    limit: 1000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Demasiadas peticiones. Espera unos minutos e inténtalo de nuevo.' }
  });
  const proteccionAcceso = limitarPeticiones(
  {
    windowMs: 15 * 60 * 1000,
    limit: 20,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Demasiados intentos de acceso. Espera unos minutos e inténtalo de nuevo.' }
  });
  aplicacion.use('/api', proteccionGeneral);
  aplicacion.use(['/api/auth/login', '/api/auth/google'], proteccionAcceso);
}

module.exports = { configurarProteccionHttp };
