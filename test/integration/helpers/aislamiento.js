const afirmar = require('node:assert/strict');
const ruta = require('node:path');
const { IncomingMessage: MensajeEntrante, ServerResponse: RespuestaServidor } = require('node:http');
const { Duplex: FlujoDoble, Writable: FlujoEscritura } = require('node:stream');
const { isolateExternals: aislarExternos } = require('../../unit/helpers/externalIsolation');
const { mockPersistence: simularPersistencia } = require('../../unit/helpers/mysql');

const secreto = 'integracion_sin_credenciales_reales';

function prepararAplicacion(prueba)
{
  const raiz = ruta.resolve(__dirname, '../../..');
  const esAplicacion = archivo => archivo === ruta.join(raiz, 'app.js') ||
    ['routes', 'utils', 'services'].some(carpeta => archivo.startsWith(ruta.join(raiz, carpeta) + ruta.sep));
  const anteriores = Object.entries(require.cache).filter(([archivo]) => esAplicacion(archivo));
  for (const [archivo] of anteriores)
  {
    delete require.cache[archivo];
  }
  prueba.after(() =>
  {
    for (const archivo of Object.keys(require.cache))
    {
      if (esAplicacion(archivo))
      {
        delete require.cache[archivo];
      }
    }
    for (const [archivo, modulo] of anteriores)
    {
      require.cache[archivo] = modulo;
    }
  });

  // Bloquea TCP, TLS, HTTP saliente y fetch; restaura entorno y mocks al finalizar.
  const { replace: sustituir } = aislarExternos(prueba, {
    NODE_ENV: 'test', JWT_SECRET: secreto, GOOGLE_AUTH_ENABLED: 'false', GOOGLE_CLIENT_ID: '',
    ELASTICSEARCH_ENABLED: 'false', EMAIL_USER: 'correo@example.test', EMAIL_PASS: 'ficticia',
    MERCADOPAGO_ACCESS_TOKEN: 'TEST-ficticio', PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '',
    FIREBASE_SERVICE_ACCOUNT_KEY: '{"project_id":"integracion"}',
    FIREBASE_SERVICE_ACCOUNT_PATH: '', FIREBASE_STORAGE_BUCKET: 'integracion.example.test'
  });
  // El reportero nativo también usa console: no ocultar su salida.
  for (const metodo of ['log', 'warn', 'error', 'info'])
  {
    console[metodo].mock.restore();
  }
  prueba.mock.method(require('node:net').Server.prototype, 'listen', () =>
  {
    afirmar.fail('La integración no debe abrir un servidor TCP');
  });
  const enviarCorreo = prueba.mock.fn(async () => ({ messageId: 'correo-simulado' }));
  const transporte = { verify: prueba.mock.fn(async () => {}), sendMail: enviarCorreo };
  sustituir('nodemailer', { createTransport: prueba.mock.fn(() => transporte) });
  const fragmentos = [];
  const archivoFirebase = {
    createWriteStream: prueba.mock.fn(() => new FlujoEscritura({
      write(fragmento, codificacion, continuar)
      {
        fragmentos.push(Buffer.from(fragmento));
        continuar();
      }
    })),
    makePublic: prueba.mock.fn(async () => {})
  };
  const deposito = { name: 'integracion.example.test', file: prueba.mock.fn(() => archivoFirebase) };
  sustituir('firebase-admin', {
    credential: { cert: prueba.mock.fn(() => 'credencial-ficticia') },
    initializeApp: prueba.mock.fn(() => {}),
    storage: prueba.mock.fn(() => ({ bucket: () => deposito }))
  });
  const pago = { id: 123, status: 'approved', status_detail: 'accredited', currency_id: 'MXN',
    transaction_amount: 1000, external_reference: '7' };
  const obtenerPago = prueba.mock.fn(async () => structuredClone(pago));
  sustituir('mercadopago', {
    MercadoPagoConfig: prueba.mock.fn(function () {}),
    Payment: prueba.mock.fn(function () { this.get = obtenerPago; }),
    Preference: prueba.mock.fn(function ()
    {
      this.create = () => afirmar.fail('Preferencia no prevista');
    })
  });

  const tablas = {
    solicitudes_pago: [{ id_solicitud: 7, id_estado: 1, monto: 1000, id_cliente: 9,
      id_empresa_auditora: 11, id_empresa: 11, concepto: 'Auditoría ambiental' }],
    auditorias: [{ id_auditoria: 20, id_empresa_auditora: 11, id_cliente: 9, id_estado: 1 }],
    reportes: [], usuarios: [{ id_usuario: 9, nombre: 'Cliente', correo: 'cliente@example.test' }]
  };
  const columnas = {
    solicitudes_pago: 'id_solicitud id_estado monto id_cliente id_empresa_auditora id_empresa concepto mercadopago_payment_id mercadopago_status mercadopago_status_detail pagada_en mercadopago_actualizado_en mercadopago_transaction_amount',
    auditorias: 'id_auditoria id_empresa_auditora id_cliente id_solicitud_pago id_estado monto creada_en objetivo',
    reportes: 'id_reporte id_auditoria nombre tipo observaciones url nombre_archivo creado_por fecha_creacion'
  };
  const cambios = [];
  // Solo se sustituye el driver; repositorio, transacciones, JWT y rutas siguen siendo reales.
  const persistencia = simularPersistencia(prueba, {
    execute(sentencia, parametros)
    {
      let coincidencia;
      if ((coincidencia = /^SELECT \* FROM `(\w+)`$/.exec(sentencia)))
      {
        afirmar.ok(Object.hasOwn(tablas, coincidencia[1]), sentencia);
        return structuredClone(tablas[coincidencia[1]]);
      }
      if (sentencia === 'SELECT * FROM solicitudes_pago WHERE id_solicitud=?')
      {
        return structuredClone(tablas.solicitudes_pago.filter(fila => fila.id_solicitud === parametros[0]));
      }
      if (sentencia === 'SELECT nombre,correo FROM usuarios WHERE id_usuario=?')
      {
        return structuredClone(tablas.usuarios.filter(fila => fila.id_usuario === parametros[0]));
      }
      if ((coincidencia = /^SHOW COLUMNS FROM `(\w+)`$/.exec(sentencia)))
      {
        return columnas[coincidencia[1]].split(' ').map(campo => ({ Field: campo, Type: 'varchar' }));
      }
      if (sentencia.startsWith('INSERT IGNORE INTO app_sequences') || sentencia.startsWith('UPDATE app_sequences'))
      {
        return { affectedRows: 1 };
      }
      if (sentencia.startsWith('SELECT last_id'))
      {
        return [{ last_id: 0 }];
      }
      if ((coincidencia = /^SELECT COALESCE\(MAX\(`(\w+)`\),0\) AS maximum FROM `(\w+)`$/.exec(sentencia)))
      {
        return [{ maximum: Math.max(0, ...tablas[coincidencia[2]].map(fila => fila[coincidencia[1]])) }];
      }
      if ((coincidencia = /^INSERT INTO `(\w+)` \(([^)]+)\) VALUES/.exec(sentencia)))
      {
        const campos = [...coincidencia[2].matchAll(/`(\w+)`/g)].map(elemento => elemento[1]);
        tablas[coincidencia[1]].push(Object.fromEntries(campos.map((campo, indice) => [campo, parametros[indice]])));
        cambios.push(sentencia);
        return { affectedRows: 1 };
      }
      if ((coincidencia = /^UPDATE `(\w+)` SET (.+) WHERE `(\w+)`=\?/.exec(sentencia)))
      {
        const campos = [...coincidencia[2].matchAll(/`(\w+)`=\?/g)].map(elemento => elemento[1]);
        const fila = tablas[coincidencia[1]].find(elemento => elemento[coincidencia[3]] === parametros[campos.length]);
        afirmar.ok(fila, sentencia);
        campos.forEach((campo, indice) => { fila[campo] = parametros[indice]; });
        cambios.push(sentencia);
        return { affectedRows: 1 };
      }
      afirmar.fail(`SQL no previsto: ${sentencia}`);
    }
  });
  // Los tres SDK y mysql2 ya están interceptados ANTES de importar app.js.
  const aplicacion = require('../../../app');
  return { ...persistencia, tablas, cambios, pago, obtenerPago, enviarCorreo, deposito,
    archivoFirebase, fragmentos, solicitar: (metodo, destino, opciones) => solicitar(aplicacion, metodo, destino, opciones) };
}

async function solicitar(aplicacion, metodo, destino, { token, cuerpo, contenido, tipo = 'application/json' } = {})
{
  const fragmentos = [];
  const flujo = new FlujoDoble({
    read() {},
    write(fragmento, codificacion, continuar)
    {
      fragmentos.push(Buffer.from(fragmento));
      continuar();
    }
  });
  const solicitud = new MensajeEntrante(flujo);
  solicitud.httpVersion = '1.1';
  solicitud.httpVersionMajor = 1;
  solicitud.httpVersionMinor = 1;
  solicitud.method = metodo;
  solicitud.url = destino;
  solicitud.headers = { host: 'integracion.test', connection: 'close' };
  if (token)
  {
    solicitud.headers.authorization = `Bearer ${token}`;
  }
  const datos = contenido === undefined ? (cuerpo === undefined ? null : Buffer.from(JSON.stringify(cuerpo))) : Buffer.from(contenido);
  if (datos)
  {
    solicitud.headers['content-type'] = tipo;
    solicitud.headers['content-length'] = String(datos.length);
  }
  const respuesta = new RespuestaServidor(solicitud);
  respuesta.assignSocket(flujo);
  let temporizador;
  try
  {
    return await new Promise((resolver, rechazar) =>
    {
      temporizador = setTimeout(() => rechazar(new Error(`Tiempo agotado: ${metodo} ${destino}`)), 3000);
      solicitud.once('error', rechazar);
      respuesta.once('error', rechazar);
      flujo.once('error', rechazar);
      respuesta.once('finish', () =>
      {
        try
        {
          const texto = Buffer.concat(fragmentos).toString('utf8').split('\r\n\r\n').slice(1).join('\r\n\r\n');
          const tipoRespuesta = String(respuesta.getHeader('content-type') || '');
          resolver({ estado: respuesta.statusCode, cuerpo: tipoRespuesta.includes('application/json') ? JSON.parse(texto) : texto,
            texto, tipo: tipoRespuesta });
        }
        catch (error)
        {
          rechazar(error);
        }
      });
      if (datos)
      {
        solicitud.push(datos);
      }
      solicitud.push(null);
      solicitud.complete = true;
      aplicacion.handle(solicitud, respuesta, rechazar);
    });
  }
  finally
  {
    clearTimeout(temporizador);
    solicitud.destroy();
    respuesta.destroy();
    flujo.destroy();
  }
}

function crearFormulario()
{
  const limite = 'limite-integracion';
  const pdf = '%PDF-1.4\nReporte simulado\n%%EOF';
  const contenido = [
    `--${limite}\r\nContent-Disposition: form-data; name="id_auditoria"\r\n\r\n20\r\n`,
    `--${limite}\r\nContent-Disposition: form-data; name="nombre"\r\n\r\nReporte final\r\n`,
    `--${limite}\r\nContent-Disposition: form-data; name="archivo"; filename="reporte.pdf"\r\nContent-Type: application/pdf\r\n\r\n${pdf}\r\n`,
    `--${limite}--\r\n`
  ].join('');
  return { contenido, tipo: `multipart/form-data; boundary=${limite}`, pdf: Buffer.from(pdf) };
}

module.exports = { prepararAplicacion, crearFormulario, secreto };
