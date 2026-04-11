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
