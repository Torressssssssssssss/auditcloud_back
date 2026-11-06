# Acceso con Google Identity Services

El frontend carga `https://accounts.google.com/gsi/client` desde `src/index.html` y muestra el botón oficial en modo popup. Envía la credencial mediante `POST /api/auth/google` con `{ "token": "ID_TOKEN" }`.

El backend usa la dependencia existente `google-auth-library` para validar firma, emisor, caducidad y audiencia. El Client ID del backend debe coincidir con `identificadorClienteGoogle` del frontend. `GOOGLE_AUTH_ENABLED=true` y `googleSignInEnabled=true` habilitan el acceso.

Las credenciales privadas pertenecen exclusivamente a `auditcloud_back/.env`, que Compose carga con `env_file` y se excluye de Git y de la imagen Docker. `GOOGLE_CLIENT_SECRET` está reservado para un eventual flujo de autorización; verificar un ID token no necesita ese secreto. Angular no requiere paquetes npm adicionales: utiliza el SDK oficial servido por Google.

En el cliente OAuth de tipo aplicación web de Google Cloud, registrar `https://auditcloud.site` en **Orígenes autorizados de JavaScript**. Si se utiliza localhost, autorizar también `http://localhost:4200`. Este flujo usa un callback JavaScript con popup y no necesita un endpoint de redirección. Si la pantalla de consentimiento está en pruebas, añadir las cuentas que van a probarlo a los usuarios de prueba.

Los usuarios nuevos se registran como clientes, independientemente del rol que intente enviar el navegador. Los usuarios existentes conservan su rol. La identidad se busca primero por el identificador estable `sub`. Solo se vinculan automáticamente por correo cuentas Gmail o Workspace con correo verificado; otros correos existentes deben acceder con contraseña. Las cuentas desactivadas o vinculadas a otro identificador se rechazan.

Al completar los datos de empresa, la API devuelve un JWT renovado con `id_empresa` y Angular actualiza la sesión.

Desde la raíz del proyecto, reconstruir y recrear los servicios para aplicar el código y las variables:

```bash
docker compose --env-file .env -f auditcloud_back/docker-compose.yml up -d --build --wait backend frontend
```

La compilación y las pruebas automatizadas no sustituyen la comprobación final en navegador con una cuenta de Google autorizada.

Referencias oficiales:

- https://developers.google.com/identity/gsi/web/guides/display-button
- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
