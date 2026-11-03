# AC-04: dashboard ambiental en tiempo real

## Dependencias y preparación

Se añadieron a los manifiestos `socket.io` (backend), `socket.io-client` y
`chart.js` (frontend). Esta sesión no tiene resolución DNS hacia
registry.npmjs.org: la instalación falló con EAI_AGAIN. Los lockfiles existentes
no se han inventado ni modificado manualmente. Antes de compilar o desplegar,
ejecutar en un entorno con acceso a npm:

```sh
cd auditcloud_back
npm install --no-audit --no-fund
cd ../auditcloud_front
npm install --no-audit --no-fund
npm test -- --watch=false
npm run build
```

Revisar y guardar ambos package-lock.json generados; después CI podrá volver a
utilizar npm ci. La migración AC-01 debe estar aplicada previamente. No se
necesita otra migración de datos para AC-04.

## Acceso y contrato

La ruta Angular `/supervisor/dashboard-directivo` aparece en el menú Alta
Dirección. Se usa el rol SUPERVISOR (id_rol=1) ya existente, sin crear un nuevo rol.
El alcance comprende las auditorías de la empresa auditora del supervisor;
no combina información de empresas auditoras distintas.

`GET /api/direccion/consumos-mensuales?anio=2026` exige JWT y rol supervisor.
Obtiene siempre la empresa del JWT y devuelve:

```json
{
  "anio": 2026,
  "agua": ["0", "15.000", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
  "energia": ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
  "unidad_agua": "m3",
  "unidad_energia": "kWh"
}
```

Cada medición se atribuye al mes de fecha_fin. Un periodo que cruza meses no se
prorratea; esta política se explica en la pantalla. Se convierten litros a m³
dividiendo por 1000 y MWh a kWh multiplicando por 1000 antes de sumar. Los meses
sin registros se rellenan con cero. Los valores JSON siguen siendo cadenas
decimales; solo las coordenadas de Chart.js se convierten a Number para dibujar.
La tabla de valores accesible mantiene la representación decimal original.

## Socket y transacciones

El servidor HTTP de app.js sirve Express y Socket.IO en el mismo puerto. El path
es `/api/socket.io`, dentro del proxy existente `/api/`. El JWT se transmite en
`handshake.auth.token`, nunca como parámetro de URL. El middleware verifica firma,
expiración, rol, empresa y que la cuenta esté activa en MySQL. Cada supervisor se
incorpora exclusivamente a `direccion:empresa:<id_empresa>`. El servidor asigna
la sala; no hay un evento cliente para escoger empresas o publicar mediciones.
La conexión se cierra al vencer el JWT.

POST /api/auditor/evidencias programa `nuevo_consumo` con afterCommit después de
insertar la medición. El evento contiene id_evidencia, id_auditoria y los cinco
campos del consumo AC-01. Si hay rollback o falla commit, no se publica. La
empresa se toma del auditor, cuya asignación y pertenencia ya validó la ruta.

El frontend consulta un snapshot inicial. Cada evento o reconexión vuelve a
consultar el agregado autorizado. No incrementa ciegamente los totales: los
eventos duplicados o fuera de orden no duplican valores. Se agrupan ráfagas
durante 150 ms y switchMap cancela consultas anteriores. Al salir se destruyen
las gráficas, las suscripciones y la conexión. HTTPS es obligatorio en modo
producción y el navegador negocia WSS para la actualización del transporte.

## Proxy Nginx

Configurar FRONTEND_URL con los orígenes permitidos. El origen se verifica tanto
para polling como para la solicitud de actualización a WebSocket; CORS no
reemplaza la validación JWT. Los middlewares de Express no cubren automáticamente
el tráfico manejado por Socket.IO.

El virtual host actual necesita cabeceras Upgrade. Añadir este bloque dentro del
servidor HTTPS de Nginx, conservar el resto de locations y validar con nginx -t:

```nginx
location /api/socket.io/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 75s;
}
```

Después recargar Nginx y reiniciar auditcloud-backend para usar el nuevo servidor
HTTP. En esta sesión no se modificó /etc/nginx ni se reinició producción, debido
a las restricciones del servidor ya identificadas. El proxy de Angular incluye
ws:true para desarrollo. Socket.IO conserva polling como transporte alternativo
cuando no se puede realizar Upgrade.

## Límites operativos y QA

La publicación es en memoria y para un único proceso Node. Una caída entre commit
y envío puede perder el evento, pero la recarga/reconexión recupera el snapshot.
No se promete entrega exactamente una vez. Para múltiples procesos o instancias
se requiere un adaptador compartido, afinidad para polling y, si se exige entrega
persistente, un patrón outbox. El endpoint muestra nuevas altas; los borrados de
evidencias existentes se reflejan en la siguiente recarga o reconexión, sin un
evento de borrado en este alcance.

Las pruebas backend cubren autorización, aislamiento por empresa, parámetros,
representación mensual y publicación tras commit/ausencia ante rollback con
MySQL simulado. Las pruebas del componente usan Socket.IO y Chart.js simulados;
solo podrán ejecutarse después de instalar las dependencias reales. La validación
de extremo a extremo de TLS, Upgrade y un navegador real sigue siendo operativa.

Referencias oficiales:

- https://socket.io/docs/v4/middlewares/
- https://socket.io/docs/v4/server-initialization/
- https://www.chartjs.org/docs/latest/developers/updates.html
