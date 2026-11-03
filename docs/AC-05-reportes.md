# AC-05: resumen de hallazgos en PDF

## Instalación

Desde `auditcloud_back`, ejecutar `npm install` para instalar PDFKit 0.17.2,
declarado en `package.json`, y actualizar `package-lock.json` antes de usar `npm ci`.
La instalación en el entorno de implementación quedó bloqueada por un error DNS
`EAI_AGAIN` al acceder a `registry.npmjs.org`; el lockfile no se modificó manualmente.

Se requiere el esquema MySQL actual, incluida la tabla `consumos_ambientales` de
`migrations/20261103_consumos_ambientales.sql` (AC-01). No requiere nuevas tablas,
Chromium, archivos temporales ni credenciales adicionales.

## Descarga

```bash
curl --fail --show-error \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/reportes/generar/20 \
  --output reporte.pdf
```

La respuesta es un Buffer con `Content-Type: application/pdf`,
`Content-Disposition: attachment; filename="reporte.pdf"` y `Cache-Control: no-store`.
La generación ocurre al solicitar el endpoint y no cambia el estado de la auditoría.

Acceso: supervisor de la empresa auditora, auditor participante o cliente propietario.
Respuestas JSON: 400 (ID inválido), 401 (sin token), 403 (token/rol inválido),
404 (auditoría inexistente o sin acceso), 500 (fallo interno).

Una sola consulta parametrizada une auditoría, ambas empresas, estado, cliente,
evidencias, autores, módulos y consumos. Los `LEFT JOIN` conservan auditorías sin
evidencias y evidencias sin consumo; `EXISTS` evita duplicar hallazgos por participantes.
Como el esquema no tiene una entidad separada de hallazgos, cada evidencia representa
una fila del resumen. Se muestran descripción, autor, fecha, archivo y consumo con
su unidad y periodo, sin sumar recursos o unidades diferentes.

El PDF incluye encabezado AuditCloud, empresas, RFC, estado, objetivo, total de
evidencias, tabla y numeración de páginas. Las descripciones largas continúan en
otras páginas con encabezado de tabla repetido.

## Validación

```bash
npm run lint
npm run test:unit
node --test test/integration/reportes.integration.test.js
node test/integration/reportes.integration.test.js
node test/unit/reportes.test.js
```

Las pruebas HTTP usan JWT y Express reales con MySQL y generador PDF simulados.
Las pruebas unitarias de PDF usan PDFKit real y se omiten explícitamente cuando
la dependencia no está instalada. Tras instalarla deben ejecutarse para verificar
el contenido y la paginación del documento real.

Referencia de la biblioteca: https://pdfkit.org/docs/getting_started.html
