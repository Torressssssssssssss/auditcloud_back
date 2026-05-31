API backend de AuditCloud construida con Express y persistencia local en JSON.


## Stack

```
Node.js + Express + JWT + JSON files
PayPal + Firebase (opcional) + SMTP
Puerto: 3000
```


## Inicio Rapido

```bash
npm install
npm run dev
```

Salud:

```bash
curl http://localhost:3000/
```


## .env Minimo

```env
JWT_SECRET=replace_with_a_strong_secret

PAYPAL_CLIENT_ID=your_client_id
PAYPAL_CLIENT_SECRET=your_client_secret
PAYPAL_API=https://api-m.sandbox.paypal.com

EMAIL_USER=youremail@gmail.com
EMAIL_PASS=your_app_password

# Opcional Firebase
# FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
# FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
# FIREBASE_STORAGE_BUCKET=your-bucket.appspot.com
```


## Integración MySQL

Esta integración es **paralela**: el backend actual sigue funcionando con JSON (`/data` + `utils/jsonDb.js`) y se agregan rutas nuevas para probar MySQL sin romper las rutas existentes.

### Variables de entorno (MySQL)

Usa un archivo `.env` (ignorado por git) basado en `.env.example`:

```env
DB_HOST=192.168.1.243
DB_PORT=3306
DB_USER=auditcloud_app
DB_PASSWORD=App.2026
DB_NAME=auditcloud_db
```

### Dependencias

```bash
npm install
```

### Correr el backend

```bash
npm start
# o
npm run dev
```

### Endpoints MySQL (pruebas)

- `GET /api/mysql/health` (conexión: `SELECT 1 AS ok`)
- `GET /api/mysql/empresas` (primeras 50 empresas)
- `GET /api/mysql/usuarios` (primeros 50 usuarios con JOIN a `roles` y `empresas`)
- `GET /api/mysql/auditorias` (primeras 50 auditorías con JOIN a empresa auditora, cliente y estado)
- `GET /api/mysql/resumen` (conteos de tablas principales)

Ejemplos:

```bash
curl http://localhost:3000/api/mysql/health
curl http://localhost:3000/api/mysql/resumen
```

### Endpoints de fragmentación (vistas)

Para demostrar fragmentación (Lab): consultas a vistas en MySQL (con `LIMIT 50`).

Empresas:

- `GET /api/fragmentos/empresas/norte`
- `GET /api/fragmentos/empresas/centro`
- `GET /api/fragmentos/empresas/sur`
- `GET /api/fragmentos/empresas/ambiental`
- `GET /api/fragmentos/empresas/financiera`
- `GET /api/fragmentos/empresas/seguridad`

Auditorías:

- `GET /api/fragmentos/auditorias/norte`
- `GET /api/fragmentos/auditorias/centro`
- `GET /api/fragmentos/auditorias/sur`
- `GET /api/fragmentos/auditorias/ambiental`
- `GET /api/fragmentos/auditorias/financiera`
- `GET /api/fragmentos/auditorias/seguridad`

Ejemplos:

```bash
curl http://localhost:3000/api/fragmentos/empresas/norte
curl http://localhost:3000/api/fragmentos/auditorias/ambiental
```

### Errores

- Si MySQL no está configurado en `.env` o no se puede conectar, estas rutas responden `500` con un mensaje claro **sin exponer credenciales**.


## Estructura

```
app.js
routes/
utils/
data/
```


## Roles

```
1 = Supervisor
2 = Auditor
3 = Cliente
```


## Credenciales de Acceso (Demo)

```txt
SUPERVISOR
correo   : supervisor@auditora-demo.com
password : 123456

AUDITOR
correo   : auditor@auditora-demo.com
password : 123456

CLIENTE
correo   : cliente@empresa-demo.com
password : 123456
```

Nota: estas credenciales son solo para entorno local/demo.


## Rutas Base

```
/api/auth
/api/supervisor
/api/auditor
/api/cliente
/api/paypal
/api/timeline
```


## Scripts

```bash
npm start
npm run dev
node test.js
node test-firebase.js
```


## Notas Clave

- La persistencia es por archivos JSON (sin DB relacional/no relacional).
- Las rutas protegidas usan `Authorization: Bearer <token>`.
- Hay integraciones opcionales con PayPal, Firebase y SMTP.
