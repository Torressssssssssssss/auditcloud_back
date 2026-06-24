# Resumen - Fragmentacion fisica en 2 nodos

## Que se implemento

Se separo la demostracion academica de AuditCloud en dos bases nuevas, sin cambiar la app ni `auditcloud_db`:

- Nodo Centro, host `192.168.30.1`, base `auditcloud_frag_centro`.
- Nodo Dan Norte-Sur, host `192.168.30.11`, base `auditcloud_frag_dan`.

La app sigue usando `auditcloud_db`. Las bases de fragmentacion son fisicas y separadas para el laboratorio.

## Por que ahora cuenta como fragmentacion fisica real

Antes existian vistas como `empresas_norte`, `empresas_centro` y `auditorias_sur` dentro de la misma base. Eso sirve para simular predicados, pero no separa fisicamente los datos.

Una replica completa tampoco es fragmentacion: cada nodo tiene todos los datos.

Con esta implementacion, cada nodo contiene tablas fisicas propias en una base distinta:

- `auditcloud_frag_centro.empresas`
- `auditcloud_frag_dan.empresas`
- y sus tablas derivadas.

Cada nodo guarda solo las filas que cumplen su predicado regional.

## Criterios

Nodo Centro `192.168.30.1`:

- CDMX
- Ciudad de México
- AGS
- Aguascalientes
- Jalisco
- Guanajuato
- Michoacán
- SLP
- San Luis Potosí
- Hidalgo
- EdoMex
- Estado de México
- Querétaro
- Morelos
- Colima
- Nayarit
- Tlaxcala

Nodo Dan `192.168.30.11`:

- NL
- Nuevo León
- Coahuila
- Chihuahua
- Sonora
- BC
- Baja California
- Sinaloa
- Durango
- Tamaulipas
- Zacatecas
- Puebla
- Oaxaca
- Guerrero
- QRoo
- Quintana Roo
- Veracruz
- Yucatán
- Campeche
- Tabasco
- Chiapas

## Tablas fragmentadas

Fragmentacion primaria:

- `empresas`, por `estado`.

Fragmentacion derivada:

- `solicitudes_pago`, por `COALESCE(id_empresa_cliente, id_empresa)`.
- `auditorias`, por `id_solicitud_pago` dentro del fragmento.
- `evidencias`, por `id_auditoria` dentro del fragmento.
- `reportes`, por `id_auditoria` dentro del fragmento.
- `conversaciones`, por empresa del usuario cliente.
- `mensajes`, por `id_conversacion` dentro del fragmento.

## Tablas replicadas

Catalogos copiados completos en ambos nodos:

- `roles`
- `tipos_empresa`
- `estados_auditoria`
- `estados_solicitud_pago`
- `tipos_auditoria`
- `modulos_ambientales`

## Fragmentacion derivada

Las tablas no regionales se asignan al nodo que contiene la empresa relacionada. No se inventaron relaciones:

- Auditorias dependen de solicitudes.
- Solicitudes dependen de empresa cliente si existe, si no de empresa owner.
- Evidencias y reportes dependen de auditoria.
- Conversaciones dependen del cliente y su empresa.
- Mensajes dependen de conversacion.

## Validar completitud

La suma:

```text
empresas Centro + empresas Dan = empresas auditcloud_db cubiertas por los predicados
```

En los datos actuales, los estados existentes quedan cubiertos por los dos predicados.

## Validar disjuncion

No debe existir un mismo `id_empresa` en ambos fragmentos.

Si ambas bases son accesibles desde un nodo:

```sql
SELECT COUNT(*) AS traslape
FROM auditcloud_frag_centro.empresas c
JOIN auditcloud_frag_dan.empresas d ON d.id_empresa = c.id_empresa;
```

Debe devolver `0`.

## Evidencia para el reporte

Tomar capturas o salidas de:

- `SHOW DATABASES LIKE 'auditcloud_frag_%';`
- `SELECT * FROM auditcloud_frag_centro.v_resumen_fragmento;`
- `SELECT * FROM auditcloud_frag_dan.v_resumen_fragmento;`
- conteos por estado en ambos nodos.
- validaciones de estados fuera del predicado con resultado `0`.
- `SHOW REPLICA STATUS\G` en Dan antes y despues.
- evidencia de que `auditcloud_db` sigue existiendo intacta.
