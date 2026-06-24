# Instrucciones para Dan - Fragmento Norte-Sur

Objetivo: crear en tu MySQL una base nueva `auditcloud_frag_dan` con tablas fisicas del fragmento Norte-Sur. No se debe borrar ni modificar `auditcloud_db`.

## 1. Confirmar VPN y MySQL

Confirma que estas conectado a la VPN de AuditCloud y que tu MySQL esta activo.

```sql
SHOW DATABASES LIKE 'auditcloud_db';
```

## 2. Confirmar replica antes de fragmentar

Ejecuta:

```sql
SHOW VARIABLES LIKE 'read_only';
SHOW VARIABLES LIKE 'super_read_only';
SHOW REPLICA STATUS\G
```

Revisa:

- `Replica_IO_Running`: debe estar en `Yes`.
- `Replica_SQL_Running`: debe estar en `Yes`.
- `Seconds_Behind_Source`: idealmente `0` o un valor estable.

Si la replica esta atrasada o con error, no ejecutes el script hasta resolverlo.

## 3. Ejecutar fragmentacion

Desde tu servidor, con un usuario administrador local:

```bash
mysql < 02_dan_crear_fragmento_norte_sur.sql
```

El script crea `auditcloud_frag_dan`, tablas fisicas, catalogos replicados y datos Norte-Sur derivados desde tu `auditcloud_db` replicada.

Si tu servidor tiene binlog activo y no quieres propagar esta base local a otro nodo, puedes ejecutar en la misma sesion antes del script:

```sql
SET SESSION SQL_LOG_BIN=0;
```

Hazlo solo si sabes que aplica y tu usuario tiene permisos. No detengas la replica solo para esto.

## 4. Ejecutar validacion

```bash
mysql < 04_validar_dan.sql
```

## 5. Resultados que debes copiar

Comparte:

```sql
SHOW DATABASES LIKE 'auditcloud_frag_dan';
SELECT * FROM auditcloud_frag_dan.v_resumen_fragmento;
SELECT * FROM auditcloud_frag_dan.v_empresas_por_estado ORDER BY estado;
SHOW REPLICA STATUS\G
```

Tambien copia los resultados de:

- `empresas_fuera_de_norte_sur`
- `empresas_centro_en_dan`
- `auditorias_sin_empresa_norte_sur`

Esos conteos deben ser `0`.

## 6. Que NO hacer

- No borres `auditcloud_db`.
- No ejecutes `DROP` sobre bases productivas o de prueba.
- No modifiques usuarios.
- No detengas VPN.
- No cambies `replication source`.
- No ejecutes scripts en la base equivocada.
- No pegues contrasenas en capturas ni mensajes.
