-- AuditCloud Lab VIII - Fragmentacion fisica 2 nodos
-- Nodo local Centro: 192.168.30.1
-- Seguro para la app: no modifica auditcloud_db ni la conexion actual.
--
-- Seguridad con replica:
-- Este fragmento local es de demostracion. Si el servidor principal tiene
-- binlog activo y replicas conectadas, desactivar el log binario de la sesion
-- evita propagar auditcloud_frag_centro a otros nodos.
SET SESSION SQL_LOG_BIN=0;

CREATE DATABASE IF NOT EXISTS auditcloud_frag_centro
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auditcloud_frag_centro.fragmentacion_info (
  id INT NOT NULL AUTO_INCREMENT,
  nodo VARCHAR(80) NOT NULL,
  host VARCHAR(80) NOT NULL,
  criterio TEXT NOT NULL,
  fecha_creacion DATETIME NOT NULL,
  origen VARCHAR(120) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auditcloud_frag_centro.roles LIKE auditcloud_db.roles;
CREATE TABLE IF NOT EXISTS auditcloud_frag_centro.tipos_empresa LIKE auditcloud_db.tipos_empresa;
CREATE TABLE IF NOT EXISTS auditcloud_frag_centro.estados_auditoria LIKE auditcloud_db.estados_auditoria;
CREATE TABLE IF NOT EXISTS auditcloud_frag_centro.estados_solicitud_pago LIKE auditcloud_db.estados_solicitud_pago;
CREATE TABLE IF NOT EXISTS auditcloud_frag_centro.tipos_auditoria LIKE auditcloud_db.tipos_auditoria;
CREATE TABLE IF NOT EXISTS auditcloud_frag_centro.modulos_ambientales LIKE auditcloud_db.modulos_ambientales;

CREATE TABLE IF NOT EXISTS auditcloud_frag_centro.empresas LIKE auditcloud_db.empresas;
CREATE TABLE IF NOT EXISTS auditcloud_frag_centro.solicitudes_pago LIKE auditcloud_db.solicitudes_pago;
CREATE TABLE IF NOT EXISTS auditcloud_frag_centro.auditorias LIKE auditcloud_db.auditorias;
CREATE TABLE IF NOT EXISTS auditcloud_frag_centro.evidencias LIKE auditcloud_db.evidencias;
CREATE TABLE IF NOT EXISTS auditcloud_frag_centro.reportes LIKE auditcloud_db.reportes;
CREATE TABLE IF NOT EXISTS auditcloud_frag_centro.conversaciones LIKE auditcloud_db.conversaciones;
CREATE TABLE IF NOT EXISTS auditcloud_frag_centro.mensajes LIKE auditcloud_db.mensajes;

INSERT IGNORE INTO auditcloud_frag_centro.roles SELECT * FROM auditcloud_db.roles;
INSERT IGNORE INTO auditcloud_frag_centro.tipos_empresa SELECT * FROM auditcloud_db.tipos_empresa;
INSERT IGNORE INTO auditcloud_frag_centro.estados_auditoria SELECT * FROM auditcloud_db.estados_auditoria;
INSERT IGNORE INTO auditcloud_frag_centro.estados_solicitud_pago SELECT * FROM auditcloud_db.estados_solicitud_pago;
INSERT IGNORE INTO auditcloud_frag_centro.tipos_auditoria SELECT * FROM auditcloud_db.tipos_auditoria;
INSERT IGNORE INTO auditcloud_frag_centro.modulos_ambientales SELECT * FROM auditcloud_db.modulos_ambientales;

INSERT IGNORE INTO auditcloud_frag_centro.empresas
SELECT e.*
FROM auditcloud_db.empresas e
WHERE e.estado IN (
  'CDMX','Ciudad de México','AGS','Aguascalientes','Jalisco','Guanajuato',
  'Michoacán','SLP','San Luis Potosí','Hidalgo','EdoMex','Estado de México',
  'Querétaro','Morelos','Colima','Nayarit','Tlaxcala'
);

INSERT IGNORE INTO auditcloud_frag_centro.solicitudes_pago
SELECT sp.*
FROM auditcloud_db.solicitudes_pago sp
JOIN auditcloud_db.empresas e
  ON e.id_empresa = COALESCE(sp.id_empresa_cliente, sp.id_empresa)
WHERE e.estado IN (
  'CDMX','Ciudad de México','AGS','Aguascalientes','Jalisco','Guanajuato',
  'Michoacán','SLP','San Luis Potosí','Hidalgo','EdoMex','Estado de México',
  'Querétaro','Morelos','Colima','Nayarit','Tlaxcala'
);

INSERT IGNORE INTO auditcloud_frag_centro.auditorias
SELECT a.*
FROM auditcloud_db.auditorias a
JOIN auditcloud_frag_centro.solicitudes_pago sp
  ON sp.id_solicitud = a.id_solicitud_pago;

INSERT IGNORE INTO auditcloud_frag_centro.evidencias
SELECT ev.*
FROM auditcloud_db.evidencias ev
JOIN auditcloud_frag_centro.auditorias a
  ON a.id_auditoria = ev.id_auditoria;

INSERT IGNORE INTO auditcloud_frag_centro.reportes
SELECT r.*
FROM auditcloud_db.reportes r
JOIN auditcloud_frag_centro.auditorias a
  ON a.id_auditoria = r.id_auditoria;

INSERT IGNORE INTO auditcloud_frag_centro.conversaciones
SELECT c.*
FROM auditcloud_db.conversaciones c
JOIN auditcloud_db.usuarios u
  ON u.id_usuario = c.id_cliente
JOIN auditcloud_frag_centro.empresas e
  ON e.id_empresa = u.id_empresa;

INSERT IGNORE INTO auditcloud_frag_centro.mensajes
SELECT m.*
FROM auditcloud_db.mensajes m
JOIN auditcloud_frag_centro.conversaciones c
  ON c.id_conversacion = m.id_conversacion;

INSERT INTO auditcloud_frag_centro.fragmentacion_info
  (nodo, host, criterio, fecha_creacion, origen)
SELECT
  'CENTRO',
  '192.168.30.1',
  'Estados centro: CDMX, Ciudad de México, AGS, Aguascalientes, Jalisco, Guanajuato, Michoacán, SLP, San Luis Potosí, Hidalgo, EdoMex, Estado de México, Querétaro, Morelos, Colima, Nayarit, Tlaxcala',
  NOW(),
  'auditcloud_db'
WHERE NOT EXISTS (
  SELECT 1
  FROM auditcloud_frag_centro.fragmentacion_info
  WHERE nodo = 'CENTRO' AND host = '192.168.30.1'
);

CREATE OR REPLACE VIEW auditcloud_frag_centro.v_resumen_fragmento AS
SELECT 'empresas' AS tabla, COUNT(*) AS filas FROM auditcloud_frag_centro.empresas
UNION ALL SELECT 'solicitudes_pago', COUNT(*) FROM auditcloud_frag_centro.solicitudes_pago
UNION ALL SELECT 'auditorias', COUNT(*) FROM auditcloud_frag_centro.auditorias
UNION ALL SELECT 'evidencias', COUNT(*) FROM auditcloud_frag_centro.evidencias
UNION ALL SELECT 'reportes', COUNT(*) FROM auditcloud_frag_centro.reportes
UNION ALL SELECT 'conversaciones', COUNT(*) FROM auditcloud_frag_centro.conversaciones
UNION ALL SELECT 'mensajes', COUNT(*) FROM auditcloud_frag_centro.mensajes;

CREATE OR REPLACE VIEW auditcloud_frag_centro.v_empresas_por_estado AS
SELECT estado, COUNT(*) AS empresas
FROM auditcloud_frag_centro.empresas
GROUP BY estado;

CREATE OR REPLACE VIEW auditcloud_frag_centro.v_auditorias_fragmento AS
SELECT a.*, sp.id_empresa_cliente, sp.id_empresa, e.estado AS estado_fragmento
FROM auditcloud_frag_centro.auditorias a
JOIN auditcloud_frag_centro.solicitudes_pago sp
  ON sp.id_solicitud = a.id_solicitud_pago
JOIN auditcloud_frag_centro.empresas e
  ON e.id_empresa = COALESCE(sp.id_empresa_cliente, sp.id_empresa);

SELECT * FROM auditcloud_frag_centro.v_resumen_fragmento;
SELECT * FROM auditcloud_frag_centro.v_empresas_por_estado ORDER BY estado;
