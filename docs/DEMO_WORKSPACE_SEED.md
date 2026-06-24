# Demo workspace seed

Este backend mantiene MySQL como fuente principal para login y datos de integracion, y varios modulos de la UI estable leen JSON en `data/*.json`.

El script `scripts/seed-demo-workspace.js` crea datos ficticios marcados con `DEMO -` para la empresa auditora demo, sincroniza JSON y MySQL, genera archivos pequenos en `data/uploads`, y reindexa auditorias en Elasticsearch con upsert.

Uso:

```bash
node scripts/seed-demo-workspace.js
```

Antes de ejecutarlo en un entorno con datos existentes, crear respaldo de `data/*.json`, `data/uploads` y un dump MySQL de las tablas afectadas.

El script es idempotente: busca empresas por nombre, usuarios por correo, auditorias por objetivo, pagos por concepto y evidencias/reportes/mensajes por claves naturales antes de crear registros nuevos.

No usa Kibana para guardar datos. Elasticsearch se actualiza solo como copia para dashboards y Kibana Lens.
