const { it: probar } = require('node:test');
const { strict: comprobar } = require('node:assert');
const { EventEmitter: EmisorEventos } = require('node:events');
const express = require('express');
const { setImmediate: esperarTurno } = require('node:timers/promises');
const { configurarProteccionHttp } = require('../../middleware/proteccionHttp');

function preparar(prueba, entorno = 'production')
{
  const entornoAnterior = process.env.NODE_ENV;
  process.env.NODE_ENV = entorno;
  prueba.after(() =>
  {
    if(entornoAnterior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = entornoAnterior;
  });
  const aplicacion = express();
  const protecciones = [];
  prueba.mock.method(aplicacion, 'use', (ruta, proteccion) =>
  {
    protecciones.push({ ruta, proteccion });
    return aplicacion;
  });
  configurarProteccionHttp(aplicacion);
  return { aplicacion, protecciones };
}

probar('omite ambos limitadores en test para admitir peticiones simuladas sin IP', prueba =>
{
  const escenario = preparar(prueba, 'test');
  comprobar.equal(escenario.aplicacion.get('trust proxy'), 'loopback');
  comprobar.deepEqual(escenario.protecciones, []);
});

async function ejecutar(escenario, posicion, direccion, estado = 200)
{
  const solicitud = Object.create(escenario.aplicacion.request);
  Object.assign(solicitud,
  {
    app: escenario.aplicacion,
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': direccion },
    method: 'POST', url: '/api/auth/login', originalUrl: '/api/auth/login'
  });
  const respuesta = new EmisorEventos();
  Object.assign(respuesta,
  {
    headersSent: false, statusCode: estado, writableEnded: false,
    append()
    {},
    setHeader()
    {},
    status(codigo)
    {
      this.statusCode = codigo;
      return this;
    },
    send(datos)
    {
      this.datos = datos;
      return this;
    }
  });
  let permitida = false;
  await escenario.protecciones[posicion].proteccion(solicitud, respuesta, error =>
  {
    if(error) throw error;
    permitida = true;
  });
  respuesta.emit('finish');
  await esperarTurno();
  return { permitida, respuesta };
}

probar('solo confía en el proxy local y distingue las IP de los clientes', async prueba =>
{
  const escenario = preparar(prueba);
  const confianza = escenario.aplicacion.get('trust proxy fn');
  comprobar.equal(confianza('127.0.0.1'), true);
  comprobar.equal(confianza('198.51.100.1'), false);
  for(let intento = 0; intento < 21; intento++)
  {
    await ejecutar(escenario, 1, '198.51.100.10', 401);
  }
  const bloqueada = await ejecutar(escenario, 1, '198.51.100.10', 401);
  comprobar.equal(bloqueada.respuesta.statusCode, 429);
  comprobar.equal(bloqueada.permitida, false);
  comprobar.equal((await ejecutar(escenario, 1, '198.51.100.20')).permitida, true);
});

probar('la navegación habitual supera 100 peticiones y el acceso exitoso no agota los intentos', async prueba =>
{
  const escenario = preparar(prueba);
  for(let intento = 0; intento < 120; intento++)
  {
    comprobar.equal((await ejecutar(escenario, 0, '203.0.113.10')).permitida, true);
  }
  for(let intento = 0; intento < 25; intento++)
  {
    comprobar.equal((await ejecutar(escenario, 1, '203.0.113.10')).permitida, true);
  }
});
