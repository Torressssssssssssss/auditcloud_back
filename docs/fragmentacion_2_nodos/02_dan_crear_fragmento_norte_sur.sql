-- AuditCloud Lab VIII - Fragmentacion fisica 2 nodos
-- Nodo Dan Norte-Sur: 192.168.30.11
-- Ejecutar en el MySQL de Dan, donde auditcloud_db existe como replica completa.
--
-- Seguridad para replica:
-- 1) Revisar primero:
--      SHOW VARIABLES LIKE 'read_only';
--      SHOW VARIABLES LIKE 'super_read_only';
--      SHOW REPLICA STATUS\G
-- 2) Usar un usuario administrador local. No borrar auditcloud_db.
-- 3) Este script crea auditcloud_frag_dan y no ejecuta DROP.
-- 4) Si Dan tiene binlog activo y NO quiere propagar esta base local a otro nodo,
--    puede ejecutar antes, en la misma sesion y solo si tiene permisos:
--      SET SESSION SQL_LOG_BIN=0;
--    No es necesario detener la replica para crear una base local si tiene permisos.

CREATE DATABASE IF NOT EXISTS auditcloud_frag_dan
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auditcloud_frag_dan.fragmentacion_info (
  id INT NOT NULL AUTO_INCREMENT,
  nodo VARCHAR(80) NOT NULL,
  host VARCHAR(80) NOT NULL,
  criterio TEXT NOT NULL,
  fecha_creacion DATETIME NOT NULL,
  origen VARCHAR(120) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auditcloud_frag_dan.roles LIKE auditcloud_db.roles;
CREATE TABLE IF NOT EXISTS auditcloud_frag_dan.tipos_empresa LIKE auditcloud_db.tipos_empresa;
CREATE TABLE IF NOT EXISTS auditcloud_frag_dan.estados_auditoria LIKE auditcloud_db.estados_auditoria;
CREATE TABLE IF NOT EXISTS auditcloud_frag_dan.estados_solicitud_pago LIKE auditcloud_db.estados_solicitud_pago;
CREATE TABLE IF NOT EXISTS auditcloud_frag_dan.tipos_auditoria LIKE auditcloud_db.tipos_auditoria;
CREATE TABLE IF NOT EXISTS auditcloud_frag_dan.modulos_ambientales LIKE auditcloud_db.modulos_ambientales;

CREATE TABLE IF NOT EXISTS auditcloud_frag_dan.empresas LIKE auditcloud_db.empresas;
CREATE TABLE IF NOT EXISTS auditcloud_frag_dan.solicitudes_pago LIKE auditcloud_db.solicitudes_pago;
CREATE TABLE IF NOT EXISTS auditcloud_frag_dan.auditorias LIKE auditcloud_db.auditorias;
CREATE TABLE IF NOT EXISTS auditcloud_frag_dan.evidencias LIKE auditcloud_db.evidencias;
CREATE TABLE IF NOT EXISTS auditcloud_frag_dan.reportes LIKE auditcloud_db.reportes;
CREATE TABLE IF NOT EXISTS auditcloud_frag_dan.conversaciones LIKE auditcloud_db.conversaciones;
CREATE TABLE IF NOT EXISTS auditcloud_frag_dan.mensajes LIKE auditcloud_db.mensajes;

INSERT IGNORE INTO auditcloud_frag_dan.roles SELECT * FROM auditcloud_db.roles;
INSERT IGNORE INTO auditcloud_frag_dan.tipos_empresa SELECT * FROM auditcloud_db.tipos_empresa;
INSERT IGNORE INTO auditcloud_frag_dan.estados_auditoria SELECT * FROM auditcloud_db.estados_auditoria;
INSERT IGNORE INTO auditcloud_frag_dan.estados_solicitud_pago SELECT * FROM auditcloud_db.estados_solicitud_pago;
INSERT IGNORE INTO auditcloud_frag_dan.tipos_auditoria SELECT * FROM auditcloud_db.tipos_auditoria;
INSERT IGNORE INTO auditcloud_frag_dan.modulos_ambientales SELECT * FROM auditcloud_db.modulos_ambientales;

INSERT IGNORE INTO auditcloud_frag_dan.empresas
SELECT e.*
FROM auditcloud_db.empresas e
WHERE e.estado IN (
  'NL','Nuevo León','Coahuila','Chihuahua','Sonora','BC','Baja California',
  'Sinaloa','Durango','Tamaulipas','Zacatecas',
  'Puebla','Oaxaca','Guerrero','QRoo','Quintana Roo','Veracruz','Yucatán',
  'Campeche','Tabasco','Chiapas'
);

INSERT IGNORE INTO auditcloud_frag_dan.solicitudes_pago
SELECT sp.*
FROM auditcloud_db.solicitudes_pago sp
JOIN auditcloud_db.empresas e
  ON e.id_empresa = COALESCE(sp.id_empresa_cliente, sp.id_empresa)
WHERE e.estado IN (
  'NL','Nuevo León','Coahuila','Chihuahua','Sonora','BC','Baja California',
  'Sinaloa','Durango','Tamaulipas','Zacatecas',
  'Puebla','Oaxaca','Guerrero','QRoo','Quintana Roo','Veracruz','Yucatán',
  'Campeche','Tabasco','Chiapas'
);

INSERT IGNORE INTO auditcloud_frag_dan.auditorias
SELECT a.*
FROM auditcloud_db.auditorias a
JOIN auditcloud_frag_dan.solicitudes_pago sp
  ON sp.id_solicitud = a.id_solicitud_pago;

INSERT IGNORE INTO auditcloud_frag_dan.evidencias
SELECT ev.*
FROM auditcloud_db.evidencias ev
JOIN auditcloud_frag_dan.auditorias a
  ON a.id_auditoria = ev.id_auditoria;

INSERT IGNORE INTO auditcloud_frag_dan.reportes
SELECT r.*
FROM auditcloud_db.reportes r
JOIN auditcloud_frag_dan.auditorias a
  ON a.id_auditoria = r.id_auditoria;

INSERT IGNORE INTO auditcloud_frag_dan.conversaciones
SELECT c.*
FROM auditcloud_db.conversaciones c
JOIN auditcloud_db.usuarios u
  ON u.id_usuario = c.id_cliente
JOIN auditcloud_frag_dan.empresas e
  ON e.id_empresa = u.id_empresa;

INSERT IGNORE INTO auditcloud_frag_dan.mensajes
SELECT m.*
FROM auditcloud_db.mensajes m
JOIN auditcloud_frag_dan.conversaciones c
  ON c.id_conversacion = m.id_conversacion;

INSERT INTO auditcloud_frag_dan.fragmentacion_info
  (nodo, host, criterio, fecha_creacion, origen)
SELECT
  'DAN_NORTE_SUR',
  '192.168.30.11',
  'Estados norte + sur: NL, Nuevo León, Coahuila, Chihuahua, Sonora, BC, Baja California, Sinaloa, Durango, Tamaulipas, Zacatecas, Puebla, Oaxaca, Guerrero, QRoo, Quintana Roo, Veracruz, Yucatán, Campeche, Tabasco, Chiapas',
  NOW(),
  'auditcloud_db replicada'
WHERE NOT EXISTS (
  SELECT 1
  FROM auditcloud_frag_dan.fragmentacion_info
  WHERE nodo = 'DAN_NORTE_SUR' AND host = '192.168.30.11'
);

CREATE OR REPLACE VIEW auditcloud_frag_dan.v_resumen_fragmento AS
SELECT 'empresas' AS tabla, COUNT(*) AS filas FROM auditcloud_frag_dan.empresas
UNION ALL SELECT 'solicitudes_pago', COUNT(*) FROM auditcloud_frag_dan.solicitudes_pago
UNION ALL SELECT 'auditorias', COUNT(*) FROM auditcloud_frag_dan.auditorias
UNION ALL SELECT 'evidencias', COUNT(*) FROM auditcloud_frag_dan.evidencias
UNION ALL SELECT 'reportes', COUNT(*) FROM auditcloud_frag_dan.reportes
UNION ALL SELECT 'conversaciones', COUNT(*) FROM auditcloud_frag_dan.conversaciones
UNION ALL SELECT 'mensajes', COUNT(*) FROM auditcloud_frag_dan.mensajes;

CREATE OR REPLACE VIEW auditcloud_frag_dan.v_empresas_por_estado AS
SELECT estado, COUNT(*) AS empresas
FROM auditcloud_frag_dan.empresas
GROUP BY estado;

CREATE OR REPLACE VIEW auditcloud_frag_dan.v_auditorias_fragmento AS
SELECT a.*, sp.id_empresa_cliente, sp.id_empresa, e.estado AS estado_fragmento
FROM auditcloud_frag_dan.auditorias a
JOIN auditcloud_frag_dan.solicitudes_pago sp
  ON sp.id_solicitud = a.id_solicitud_pago
JOIN auditcloud_frag_dan.empresas e
  ON e.id_empresa = COALESCE(sp.id_empresa_cliente, sp.id_empresa);

SELECT * FROM auditcloud_frag_dan.v_resumen_fragmento;
SELECT * FROM auditcloud_frag_dan.v_empresas_por_estado ORDER BY estado;

-- Validacion: no debe devolver filas.
SELECT id_empresa, estado
FROM auditcloud_frag_dan.empresas
WHERE estado IN (
  'CDMX','Ciudad de México','AGS','Aguascalientes','Jalisco','Guanajuato',
  'Michoacán','SLP','San Luis Potosí','Hidalgo','EdoMex','Estado de México',
  'Querétaro','Morelos','Colima','Nayarit','Tlaxcala'
)
LIMIT 20;
