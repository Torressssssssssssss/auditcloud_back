# AuditCloud con Docker Compose — AC-08

## Inicio

Requiere Docker Engine y Docker Compose v2.24 o posterior. Desde esta carpeta:

```sh
cp .env.example .env
```

Completar `.env` con DB_USER, DB_PASSWORD, MYSQL_ROOT_PASSWORD y JWT_SECRET.
Usar un usuario de aplicación distinto de root, contraseñas diferentes para root
y la aplicación, y un secreto JWT aleatorio. Para generar valores se puede usar
`openssl rand -hex 32`. Las contraseñas con `$` o `#` pueden escribirse entre
comillas simples en el archivo .env.

```sh
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
```

Frontend: http://localhost (puerto 80). Backend: http://localhost:3000.
La configuración predeterminada sirve HTTP; para producción y el socket seguro
de AC-04 se debe publicar detrás de HTTPS, como se explica más abajo.

## Servicios y persistencia

- `db`: mysql:8.4, accesible como `db:3306` dentro de la red Compose. No publica
  MySQL en el host. El volumen `datos_mysql` conserva la base de datos.
- `backend`: imagen Node 22 Alpine, dependencias de producción y usuario node.
  HOST=0.0.0.0 permite recibir conexiones desde frontend y el puerto publicado.
  El volumen `archivos_evidencias` conserva `/app/data/uploads`.
- `frontend`: compila Angular en node:22-alpine y copia
  `dist/auditcloud_front/browser/` a nginx:alpine. Nginx sirve la SPA en puerto 80
  y deriva `/api/`, `/uploads/` y `/api/socket.io/` al servicio backend.

El backend espera a que MySQL supere su healthcheck TCP autenticado; el frontend
espera al healthcheck del backend. El DNS de Docker permite encontrar los
servicios por nombre y Nginx vuelve a resolver backend al cambiar su IP.

`docker compose down` conserva los volúmenes. `down -v` los elimina y borra los
datos, por lo que no forma parte del procedimiento habitual de actualización.

## Variables de entorno

El `.env` de la raíz proporciona las variables de interpolación de Compose:

| Variable | Uso |
| --- | --- |
| DB_USER | Usuario de aplicación creado en MySQL y utilizado por Node |
| DB_PASSWORD | Contraseña de ese usuario, idéntica en ambos servicios |
| MYSQL_ROOT_PASSWORD | Contraseña administrativa exclusiva de MySQL |
| JWT_SECRET | Clave de firma de sesiones; Compose exige que esté definida |
| FRONTEND_URL | Origen público exacto para CORS y Socket.IO; admite lista separada por comas |
| FRONTEND_PORT | Puerto publicado del frontend; predeterminado 80 |
| BACKEND_PORT | Puerto publicado del backend; predeterminado 3000 |
| ELASTICSEARCH_ENABLED | false por defecto: Elasticsearch no forma parte de estos tres servicios |

Compose establece estas variables **dentro del contenedor backend**:

```dotenv
HOST=0.0.0.0
PORT=3000
DB_HOST=db
DB_PORT=3306
DB_NAME=auditcloud_db
```

Si se ejecuta Node directamente en el host, se conserva el valor predeterminado
HOST=127.0.0.1. Para una configuración de backend usada exclusivamente dentro de
Compose, DB_HOST debe ser `db`, no `127.0.0.1`; DB_PORT es el puerto interno 3306,
no un puerto publicado del host. DB_NAME se mantiene en auditcloud_db porque el
repositorio lo exige explícitamente.

El archivo opcional `auditcloud_back/.env` puede proporcionar otras integraciones
como SMTP, Google y pagos. Las variables declaradas en `environment` de Compose
tienen prioridad sobre ese archivo: el DB_HOST local no se reutiliza por error
dentro del contenedor. No es necesario modificar el .env del backend que utiliza
el servicio systemd del host. Firebase requiere inyectar su credencial en runtime
o montar un archivo de credencial de solo lectura y definir su ruta del contenedor;
las claves privadas no se incorporan a las imágenes.

Cambiar DB_PASSWORD o MYSQL_ROOT_PASSWORD en .env no cambia las contraseñas de
usuarios que ya existen en un volumen MySQL inicializado; esa rotación debe
realizarse también en MySQL.

## Base de datos inicial

En el primer arranque de un volumen vacío, MySQL ejecuta
`docker/mysql/01_esquema.sql`. Contiene 23 tablas, seis catálogos y 33 vistas del
modelo actual, incluidos app_sequences y consumos_ambientales. Incluye los ALTER
de la migración MySQL y evita repetir el índice de solicitud de pago que ya está
declarado en la tabla auditorias.

Se crea una base nueva, sin usuarios ni datos de demostración. No se importa la
base del servidor host ni sus archivos locales. Para utilizar cuentas existentes
hay que realizar una importación controlada o provisionar los usuarios iniciales.
La tabla usuarios exige contraseñas bcrypt para iniciar sesión.

El SQL se genera a partir del esquema y la migración versionados mediante:

```sh
python3 docker/mysql/generar_esquema.py
```

El SQL original auditcloud_back/auditcloud_db.sql incluye DROP DATABASE y semillas
masivas; no se monta directamente en la inicialización del contenedor. El SQL
generado conserva solo DDL y catálogos. Los scripts de entrypoint se ejecutan
**solo con un volumen vacío**; no son un mecanismo de actualización automática
para volúmenes existentes. Las futuras migraciones se deben aplicar por separado
sin borrar los volúmenes.

## HTTPS y coexistencia con el servidor actual

Si el Nginx del host o systemd ya ocupan 80 y 3000, configurar por ejemplo:

```dotenv
FRONTEND_PORT=8080
BACKEND_PORT=3001
FRONTEND_URL=https://dominio-publico
```

El servidor HTTPS existente puede hacer proxy a http://127.0.0.1:8080 para todos
los caminos, conservando Host y las cabeceras Upgrade/Connection. Evitar que sus
locations antiguos /api y /uploads sigan enviando tráfico al backend anterior.
El Nginx del contenedor se encarga del proxy interno a backend:3000. Ajustar
FRONTEND_URL al origen que realmente utiliza el navegador.

El servicio websocket de Angular exige HTTPS en compilaciones de producción;
acceder directamente por HTTP permite servir la web, pero no habilita el socket
seguro. Esta configuración conserva esa restricción y no incorpora certificados
ni modifica el Nginx o los servicios instalados en el host.

## Verificación y límites de esta entrega

La validación de Compose no necesita acceso al daemon. Para ejecutar el entorno
se necesita una cuenta con acceso a Docker y descargar las imágenes/dependencias.
En esta sesión el socket Docker devuelve permiso denegado; no se puede afirmar
que los contenedores se hayan construido o arrancado.

nginx -t confirmó la sintaxis usando un directorio temporal, pero no completó la
prueba porque el entorno bloquea la apertura de sockets. El esquema generado se
revisó estáticamente, sin ejecutarlo en el MySQL de producción. Los healthchecks
y pruebas reales del stack se ejecutan al levantar Compose con --wait.

Referencias oficiales:

- https://docs.docker.com/compose/how-tos/startup-order/
- https://github.com/docker-library/docs/blob/master/mysql/README.md
- https://nginx.org/en/docs/http/websocket.html
