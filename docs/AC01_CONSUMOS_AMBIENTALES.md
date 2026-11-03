# AC-01: consumos ambientales

## Instalación

Requiere MySQL 8.0.16 o superior (restricciones CHECK efectivas), InnoDB,
codificación utf8mb4 y modo SQL estricto para evitar truncamientos silenciosos.
Aplicar `migrations/20261103_consumos_ambientales.sql` sobre `auditcloud_db`
antes de publicar este backend. La migración es aditiva; no convierte evidencias
históricas. Para instalaciones nuevas la tabla también está en `auditcloud_db.sql`.
No se aplicó la migración a la base de producción durante esta implementación.

La clave primaria `id_evidencia` es también FK: una evidencia admite cero o un
consumo. No necesita secuencia adicional. Borrar una evidencia elimina su consumo
mediante ON DELETE CASCADE. No se modifica aquí la política existente de cierre
de auditorías (AC-06).

## Contrato de API

`POST /api/auditor/evidencias` mantiene JWT, rol auditor, empresa y asignación.
Los campos de consumo se envían junto con la evidencia en el mismo FormData:

```json
{
  "id_auditoria": "20",
  "id_modulo": "1",
  "tipo": "COMENTARIO",
  "descripcion": "Lectura mensual del contador de agua",
  "es_consumo": "true",
  "tipo_recurso": "Agua",
  "cantidad": "125.500",
  "unidad_medida": "m3",
  "fecha_inicio": "2026-10-01",
  "fecha_fin": "2026-10-31"
}
```

Para FOTO y DOC se conserva el archivo obligatorio bajo el nombre `archivo`;
COMENTARIO permite registrar la lectura sin adjunto. El backend también admite
JSON para comentarios, con `es_consumo` booleano o cadena `true`/`false`.
Omitir `es_consumo` mantiene compatibilidad con clientes anteriores. Enviar campos
de medición con consumo desactivado devuelve 400, para no descartar datos en silencio.
Las evidencias admiten un solo JPG, PNG o PDF, máximo 5 MiB tanto en Angular como
en Express. Los reportes conservan su límite anterior de 10 MiB.

Unidades permitidas (valores canónicos, sensibles a mayúsculas):

| Recurso | Unidades |
| --- | --- |
| Agua | L, m3 |
| Energía | kWh, MWh |
| Residuos | kg, t |
| Emisiones | kgCO2e, tCO2e |

Las emisiones son masa de CO₂ equivalente; no se calculan factores de conversión.
El recurso medido y el módulo del expediente son conceptos independientes: por
ejemplo, un módulo Energía puede contener una evidencia de emisiones asociadas.
No se inserta ni asigna automáticamente un nuevo módulo Emisiones al catálogo.
El módulo de la evidencia debe continuar asignado a la auditoría.

Cantidad: entre 0 y 999999999999.999, hasta tres decimales, sin separador de miles,
con punto decimal. Cero representa ausencia de consumo en el periodo; no equivale
a un campo vacío. Las cadenas decimales se conservan sin conversión a Number.
Fechas: AAAA-MM-DD, años 1000–9999, fechas reales, fin mayor o igual que inicio.
Se permite un periodo de un día y no se prohíben fechas futuras.

Los errores de consumo devuelven HTTP 400 con `{ message, errors }`, siendo errors
un mapa por campo. `GET /api/auditor/evidencias/:idAuditoria` añade `consumo` (objeto
o null), con cantidad decimal y fechas como cadenas. Para `0` conserva el filtro
existente de evidencias propias. No se añaden aquí endpoints para editar mediciones
ni la ampliación de los listados de supervisor/cliente.

## Atomicidad

La evidencia se inserta mediante mysqlStore; la medición usa SQL parametrizado
con `query`, sobre la misma conexión de AsyncLocalStorage. transactionalRouter
confirma antes de devolver 201 y revierte las dos inserciones ante fallo SQL o
respuesta de error. No se abre una transacción anidada independiente.

Los archivos locales no participan en ACID. Para esta ruta, las respuestas de
error, incluidos fallos de commit, retiran el archivo recién recibido por Multer.
Una caída abrupta del proceso puede dejar archivos huérfanos y requiere limpieza
operativa; no se promete atomicidad distribuida entre MySQL y disco.

## Validación

Las pruebas unitarias cubren precisión, extremos, ceros, fechas imposibles,
periodos, unidades cruzadas, estructuras inválidas y compatibilidad.
Las de integración recorren Express, JWT, multipart y transacciones reales de la
aplicación con el driver MySQL simulado. Comprueban rollback, autorización y
lectura de consumos; no validan el DDL contra un MySQL real.
Las pruebas Angular comprueban aparición de campos, validación condicional,
cambio de unidad, payload multipart, reinicio y corrección de errores de API.

```sh
# Backend
npm run lint
node --test test/unit/*.test.js test/integration/*.test.js
# Frontend
npm test -- --watch=false
npm run build
```
