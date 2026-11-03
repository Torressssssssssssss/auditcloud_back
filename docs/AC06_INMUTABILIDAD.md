# AC-06: auditorías finalizadas de solo lectura

## Regla de servidor

`middleware/verificarInmutabilidad.js` consulta el estado persistido de la
auditoría con SELECT ... FOR UPDATE. Se ejecuta desde transactionalRouter
**dentro de la misma transacción de escritura y antes del controlador**.
Autenticación, roles y el parseo multipart siguen ejecutándose antes.

Al encontrar id_estado=3, la respuesta es HTTP 409:

```json
{
  "code": "AUDITORIA_FINALIZADA",
  "message": "La auditoría está FINALIZADA y es de solo lectura. No se permiten modificaciones."
}
```

La operación revierte y el controlador no se ejecuta. No hay excepciones para
supervisores ni una ruta de reapertura. Es posible pasar de un estado abierto a
FINALIZADA; cualquier escritura posterior, incluso volver a asignar estado 3,
se rechaza. No se requiere migración SQL nueva.

La lectura con bloqueo usa la conexión de AsyncLocalStorage. El bloqueo de fila
se mantiene hasta commit/rollback y se combina con el bloqueo global de escritura
que ya implementaba AuditCloud. Si el cierre obtiene primero el bloqueo, una
edición posterior lee el estado final y falla. Si la edición lo obtiene primero,
termina antes del cierre. No se consulta el estado mediante otra conexión ni se
confía en el valor enviado por el navegador.

## Rutas cubiertas

En los routers de auditor y supervisor se verifican todas las mutaciones cuyo
recurso es una auditoría, evidencia o reporte:

- PATCH del objetivo de auditoría.
- PUT/DELETE de evidencias, resolviendo la auditoría mediante la FK de la
  evidencia, sin confiar en id_auditoria enviado en el cuerpo.
- POST de evidencias, incluyendo sus consumos, y de reportes finales.
- PUT del estado, evitando reabrir una auditoría finalizada.
- POST/PUT/DELETE de asignaciones de auditores.
- POST de módulos de auditoría.
- Asignación mediante solicitud de pago, cuando ya existe la auditoría.
- POST de comentarios de timeline, para supervisores, auditores y clientes.

En esta copia no hay endpoints PUT/DELETE de módulos ni DELETE de auditorías:
no se inventaron endpoints adicionales. La resolución por idAuditoria cubre las
mutaciones bajo /auditorias/:idAuditoria, por lo que la misma comprobación se
aplicará si se incorporan dentro de estos routers.

El ámbito de empresa se obtiene de la identidad autenticada. Para comentarios
de cliente, se comprueba el id_cliente del expediente. Los handlers conservan sus
verificaciones adicionales de asignación y propiedad. Sin acceso se devuelve
403, sin revelar si la auditoría ajena está finalizada. GET y descargas conservan
su comportamiento. Los chats comerciales, usuarios, empresa y notificaciones
personales no se convierten en recursos inmutables del expediente.

Los archivos locales recién recibidos para una operación rechazada por cierre
se retiran; los reportes en memoria se rechazan antes de enviarse a Firebase.
La protección corresponde a las escrituras realizadas mediante estos routers,
no a una restricción nueva sobre administradores que ejecuten SQL directamente.

## Interfaz Angular

Los detalles de auditor y supervisor muestran FINALIZADA / Solo lectura y
deshabilitan objetivo, comentarios, módulos y asignaciones. Los métodos de
escritura también comprueban el estado, para evitar llamadas programáticas
accidentales desde el componente. Descargar y consultar siguen habilitados.

En evidencias, las auditorías cerradas se marcan y deshabilitan en el selector;
se bloquean los campos de carga y Guardar. Editar/Eliminar están disponibles
solo para evidencias propias en auditorías abiertas cargadas en la vista. Un
estado desconocido no se interpreta como editable. El editor permite cambiar
la descripción y la eliminación usa el endpoint existente, con confirmación.

Si el servidor devuelve AUDITORIA_FINALIZADA porque otra sesión cerró la
auditoría, la vista actualiza su estado a 3 y presenta el mensaje. Esta
comprobación visual complementa a la regla del servidor; no es su sustituto.

## QA

Las pruebas de integración envían peticiones directas con distintos roles y
comprueban ausencia de cambios, rollback y respuesta 409. También comprueban que
se pueda finalizar, que no se pueda reabrir y que las consultas sigan disponibles.
Las pruebas unitarias verifican uso de la conexión transaccional, FOR UPDATE,
resolución por evidencia y que no se invoque el controlador tras detectar cierre.
MySQL está simulado: la exclusión concurrente se apoya en los bloqueos de InnoDB,
y no se presenta esta suite como una prueba sobre una instancia MySQL real.

Las pruebas Angular comprueban botones deshabilitados, bloqueo de métodos,
recuperación ante un 409 por cierre remoto y edición en estado abierto.
