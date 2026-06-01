-- ==========================================================
-- AuditCloud - Script COMPLETO (MySQL 8.0.45)
-- Esquema alineado al backend (JSON DB en /data + /routes)
-- Seeds determinísticos masivos (replicación-friendly)
-- Fragmentación (Lab VIII) por region (Norte/Centro/Sur) y tipo_auditoria
--
-- Restricciones de seed masivo:
-- - Sin RAND(), UUID(), NOW(), CURRENT_TIMESTAMP en inserts masivos
-- - Sin triggers ni stored procedures
-- - Fechas determinísticas basadas en una constante
-- ==========================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';
SET SESSION cte_max_recursion_depth = 10000;

SET FOREIGN_KEY_CHECKS = 0;
DROP DATABASE IF EXISTS auditcloud_db;
CREATE DATABASE auditcloud_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE auditcloud_db;
SET FOREIGN_KEY_CHECKS = 1;

-- ==========================================================
-- 1) CATÁLOGOS (equivalentes a /data/*.json)
-- ==========================================================

CREATE TABLE roles (
  id_rol INT NOT NULL,
  nombre VARCHAR(50) NOT NULL,
  PRIMARY KEY (id_rol),
  UNIQUE KEY uq_roles_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tipos_empresa (
  id_tipo_empresa INT NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  PRIMARY KEY (id_tipo_empresa),
  UNIQUE KEY uq_tipos_empresa_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tipos_auditoria (
  clave VARCHAR(50) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  PRIMARY KEY (clave),
  UNIQUE KEY uq_tipos_auditoria_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE estados_auditoria (
  id_estado INT NOT NULL,
  nombre VARCHAR(50) NOT NULL,
  PRIMARY KEY (id_estado),
  UNIQUE KEY uq_estados_auditoria_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE estados_solicitud_pago (
  id_estado INT NOT NULL,
  nombre VARCHAR(50) NOT NULL,
  PRIMARY KEY (id_estado),
  UNIQUE KEY uq_estados_solicitud_pago_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE modulos_ambientales (
  id_modulo INT NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  clave VARCHAR(40) NULL,
  PRIMARY KEY (id_modulo),
  UNIQUE KEY uq_modulos_ambientales_nombre (nombre),
  UNIQUE KEY uq_modulos_ambientales_clave (clave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO roles (id_rol, nombre) VALUES
  (1, 'SUPERVISOR'),
  (2, 'AUDITOR'),
  (3, 'CLIENTE');

INSERT INTO tipos_empresa (id_tipo_empresa, nombre) VALUES
  (1, 'AUDITORA'),
  (2, 'CLIENTE');

INSERT INTO tipos_auditoria (clave, nombre) VALUES
  ('AMBIENTAL', 'Auditoría Ambiental'),
  ('FINANCIERA', 'Auditoría Financiera'),
  ('SEGURIDAD', 'Auditoría de Seguridad');

INSERT INTO estados_auditoria (id_estado, nombre) VALUES
  (1, 'CREADA'),
  (2, 'EN_PROCESO'),
  (3, 'FINALIZADA');

INSERT INTO estados_solicitud_pago (id_estado, nombre) VALUES
  (1, 'PENDIENTE'),
  (2, 'PAGADA');

INSERT INTO modulos_ambientales (id_modulo, nombre, clave) VALUES
  (1, 'AGUA', 'AGUA'),
  (2, 'RESIDUOS', 'RESIDUOS'),
  (3, 'ENERGIA', 'ENERGIA');

-- ==========================================================
-- 2) TABLAS PRINCIPALES (alineadas a campos usados en /routes)
-- ==========================================================

CREATE TABLE empresas (
  id_empresa INT NOT NULL,
  id_tipo_empresa INT NOT NULL,
  tipo_auditoria VARCHAR(50) NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  rfc VARCHAR(20) NULL,
  giro VARCHAR(160) NULL,
  direccion VARCHAR(200) NULL,
  ciudad VARCHAR(120) NULL,
  estado VARCHAR(120) NULL,
  pais VARCHAR(80) NOT NULL,
  contacto_nombre VARCHAR(160) NULL,
  contacto_correo VARCHAR(160) NULL,
  contacto_telefono VARCHAR(40) NULL,
  activo TINYINT(1) NOT NULL,
  PRIMARY KEY (id_empresa),
  KEY idx_empresas_tipo (id_tipo_empresa),
  KEY idx_empresas_estado (estado),
  KEY idx_empresas_tipo_auditoria (tipo_auditoria),
  CONSTRAINT fk_empresas_tipos_empresa
    FOREIGN KEY (id_tipo_empresa) REFERENCES tipos_empresa(id_tipo_empresa)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_empresas_tipos_auditoria
    FOREIGN KEY (tipo_auditoria) REFERENCES tipos_auditoria(clave)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE usuarios (
  id_usuario INT NOT NULL,
  id_empresa INT NULL,
  nombre VARCHAR(160) NOT NULL,
  correo VARCHAR(160) NOT NULL,
  password_hash VARCHAR(255) NULL,
  id_rol INT NOT NULL,
  activo TINYINT(1) NOT NULL,
  google_id VARCHAR(80) NULL,
  creado_en DATETIME NOT NULL,
  PRIMARY KEY (id_usuario),
  UNIQUE KEY uq_usuarios_correo (correo),
  KEY idx_usuarios_empresa (id_empresa),
  KEY idx_usuarios_rol (id_rol),
  CONSTRAINT fk_usuarios_empresas
    FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_usuarios_roles
    FOREIGN KEY (id_rol) REFERENCES roles(id_rol)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE empresa_modulos (
  id_empresa_modulo INT NOT NULL,
  id_empresa INT NOT NULL,
  id_modulo INT NOT NULL,
  registrado_en DATETIME NOT NULL,
  PRIMARY KEY (id_empresa_modulo),
  UNIQUE KEY uq_empresa_modulos (id_empresa, id_modulo),
  KEY idx_empresa_modulos_empresa (id_empresa),
  KEY idx_empresa_modulos_modulo (id_modulo),
  CONSTRAINT fk_empresa_modulos_empresas
    FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_empresa_modulos_modulos
    FOREIGN KEY (id_modulo) REFERENCES modulos_ambientales(id_modulo)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE solicitudes_pago (
  id_solicitud INT NOT NULL,
  id_empresa INT NOT NULL,
  id_empresa_auditora INT NOT NULL,
  id_empresa_cliente INT NULL,
  id_cliente INT NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  concepto VARCHAR(200) NOT NULL,
  id_estado INT NOT NULL,
  creado_en DATETIME NOT NULL,
  creado_por_supervisor INT NULL,
  creado_por_auditor INT NULL,
  pagada_en DATETIME NULL,
  paypal_order_id VARCHAR(64) NULL,
  PRIMARY KEY (id_solicitud),
  KEY idx_solicitudes_empresa_auditora (id_empresa_auditora),
  KEY idx_solicitudes_empresa_cliente (id_empresa_cliente),
  KEY idx_solicitudes_cliente (id_cliente),
  KEY idx_solicitudes_estado (id_estado),
  CONSTRAINT fk_solicitudes_empresas_owner
    FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_solicitudes_empresas_auditora
    FOREIGN KEY (id_empresa_auditora) REFERENCES empresas(id_empresa)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_solicitudes_empresas_cliente
    FOREIGN KEY (id_empresa_cliente) REFERENCES empresas(id_empresa)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_solicitudes_cliente
    FOREIGN KEY (id_cliente) REFERENCES usuarios(id_usuario)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_solicitudes_estado
    FOREIGN KEY (id_estado) REFERENCES estados_solicitud_pago(id_estado)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_solicitudes_creado_supervisor
    FOREIGN KEY (creado_por_supervisor) REFERENCES usuarios(id_usuario)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_solicitudes_creado_auditor
    FOREIGN KEY (creado_por_auditor) REFERENCES usuarios(id_usuario)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auditorias (
  id_auditoria INT NOT NULL,
  id_empresa_auditora INT NOT NULL,
  id_cliente INT NOT NULL,
  id_solicitud_pago INT NOT NULL,
  id_estado INT NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  creada_en DATETIME NOT NULL,
  objetivo TEXT NULL,
  estado_actualizado_en DATETIME NULL,
  fecha_inicio DATE NULL,
  PRIMARY KEY (id_auditoria),
  KEY idx_auditorias_auditora (id_empresa_auditora),
  KEY idx_auditorias_cliente (id_cliente),
  KEY idx_auditorias_solicitud (id_solicitud_pago),
  KEY idx_auditorias_estado (id_estado),
  CONSTRAINT fk_auditorias_empresas_auditora
    FOREIGN KEY (id_empresa_auditora) REFERENCES empresas(id_empresa)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_auditorias_cliente
    FOREIGN KEY (id_cliente) REFERENCES usuarios(id_usuario)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_auditorias_solicitud
    FOREIGN KEY (id_solicitud_pago) REFERENCES solicitudes_pago(id_solicitud)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_auditorias_estado
    FOREIGN KEY (id_estado) REFERENCES estados_auditoria(id_estado)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auditoria_participantes (
  id_participante INT NOT NULL,
  id_auditoria INT NOT NULL,
  id_auditor INT NOT NULL,
  asignado_en DATETIME NOT NULL,
  PRIMARY KEY (id_participante),
  UNIQUE KEY uq_auditoria_auditor (id_auditoria, id_auditor),
  KEY idx_ap_auditoria (id_auditoria),
  KEY idx_ap_auditor (id_auditor),
  CONSTRAINT fk_ap_auditoria
    FOREIGN KEY (id_auditoria) REFERENCES auditorias(id_auditoria)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_ap_auditor
    FOREIGN KEY (id_auditor) REFERENCES usuarios(id_usuario)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auditoria_modulos (
  id_auditoria_modulo INT NOT NULL,
  id_auditoria INT NOT NULL,
  id_modulo INT NOT NULL,
  registrado_en DATETIME NOT NULL,
  PRIMARY KEY (id_auditoria_modulo),
  UNIQUE KEY uq_auditoria_modulos (id_auditoria, id_modulo),
  KEY idx_am_auditoria (id_auditoria),
  KEY idx_am_modulo (id_modulo),
  CONSTRAINT fk_am_auditoria
    FOREIGN KEY (id_auditoria) REFERENCES auditorias(id_auditoria)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_am_modulo
    FOREIGN KEY (id_modulo) REFERENCES modulos_ambientales(id_modulo)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE conversaciones (
  id_conversacion INT NOT NULL,
  id_cliente INT NOT NULL,
  id_empresa_auditora INT NOT NULL,
  asunto VARCHAR(120) NOT NULL,
  creado_en DATETIME NOT NULL,
  ultimo_mensaje_fecha DATETIME NULL,
  activo TINYINT(1) NOT NULL,
  PRIMARY KEY (id_conversacion),
  KEY idx_conv_cliente (id_cliente),
  KEY idx_conv_empresa_auditora (id_empresa_auditora),
  CONSTRAINT fk_conv_cliente
    FOREIGN KEY (id_cliente) REFERENCES usuarios(id_usuario)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_conv_empresa_auditora
    FOREIGN KEY (id_empresa_auditora) REFERENCES empresas(id_empresa)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mensajes (
  id_mensaje INT NOT NULL,
  id_conversacion INT NOT NULL,
  emisor_tipo ENUM('CLIENTE','AUDITOR','SUPERVISOR') NOT NULL,
  emisor_id INT NOT NULL,
  contenido TEXT NOT NULL,
  creado_en DATETIME NOT NULL,
  PRIMARY KEY (id_mensaje),
  KEY idx_mensajes_conversacion (id_conversacion),
  KEY idx_mensajes_emisor (emisor_id),
  KEY idx_mensajes_fecha (creado_en),
  CONSTRAINT fk_mensajes_conversacion
    FOREIGN KEY (id_conversacion) REFERENCES conversaciones(id_conversacion)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_mensajes_emisor
    FOREIGN KEY (emisor_id) REFERENCES usuarios(id_usuario)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE evidencias (
  id_evidencia INT NOT NULL,
  id_auditoria INT NOT NULL,
  id_modulo INT NOT NULL,
  id_auditor INT NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  descripcion TEXT NOT NULL,
  nombre_archivo VARCHAR(255) NULL,
  url_archivo VARCHAR(500) NULL,
  creado_en DATETIME NOT NULL,
  actualizado_en DATETIME NULL,
  PRIMARY KEY (id_evidencia),
  KEY idx_evidencias_auditoria (id_auditoria),
  KEY idx_evidencias_modulo (id_modulo),
  KEY idx_evidencias_auditor (id_auditor),
  CONSTRAINT fk_evidencias_auditoria
    FOREIGN KEY (id_auditoria) REFERENCES auditorias(id_auditoria)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_evidencias_modulo
    FOREIGN KEY (id_modulo) REFERENCES modulos_ambientales(id_modulo)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_evidencias_auditor
    FOREIGN KEY (id_auditor) REFERENCES usuarios(id_usuario)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE comentarios (
  id_comentario INT NOT NULL,
  id_auditoria INT NOT NULL,
  id_usuario INT NOT NULL,
  mensaje TEXT NOT NULL,
  creado_en DATETIME NOT NULL,
  PRIMARY KEY (id_comentario),
  KEY idx_comentarios_auditoria (id_auditoria),
  KEY idx_comentarios_usuario (id_usuario),
  CONSTRAINT fk_comentarios_auditoria
    FOREIGN KEY (id_auditoria) REFERENCES auditorias(id_auditoria)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_comentarios_usuario
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notificaciones (
  id_notificacion INT NOT NULL,
  id_cliente INT NOT NULL,
  id_auditoria INT NULL,
  tipo VARCHAR(40) NOT NULL,
  titulo VARCHAR(160) NOT NULL,
  mensaje TEXT NOT NULL,
  fecha DATETIME NOT NULL,
  leida TINYINT(1) NOT NULL,
  PRIMARY KEY (id_notificacion),
  KEY idx_notif_cliente (id_cliente),
  KEY idx_notif_auditoria (id_auditoria),
  KEY idx_notif_fecha (fecha),
  CONSTRAINT fk_notif_cliente
    FOREIGN KEY (id_cliente) REFERENCES usuarios(id_usuario)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_notif_auditoria
    FOREIGN KEY (id_auditoria) REFERENCES auditorias(id_auditoria)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE reportes (
  id_reporte INT NOT NULL,
  id_auditoria INT NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  observaciones TEXT NULL,
  url VARCHAR(500) NOT NULL,
  nombre_archivo VARCHAR(255) NOT NULL,
  creado_por INT NOT NULL,
  fecha_creacion DATETIME NOT NULL,
  PRIMARY KEY (id_reporte),
  KEY idx_reportes_auditoria (id_auditoria),
  KEY idx_reportes_creado_por (creado_por),
  CONSTRAINT fk_reportes_auditoria
    FOREIGN KEY (id_auditoria) REFERENCES auditorias(id_auditoria)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_reportes_creado_por
    FOREIGN KEY (creado_por) REFERENCES usuarios(id_usuario)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tablas presentes en /data pero no usadas directamente por rutas actuales.
-- Se dejan como “compatibilidad” (sin afectar al backend).
CREATE TABLE participantes (
  id_participante INT NOT NULL,
  id_empresa INT NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  correo VARCHAR(160) NULL,
  telefono VARCHAR(40) NULL,
  cargo VARCHAR(120) NULL,
  activo TINYINT(1) NOT NULL,
  creado_en DATETIME NOT NULL,
  PRIMARY KEY (id_participante),
  KEY idx_participantes_empresa (id_empresa),
  CONSTRAINT fk_participantes_empresa
    FOREIGN KEY (id_empresa) REFERENCES empresas(id_empresa)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audiencias (
  id_audiencia INT NOT NULL,
  id_auditoria INT NOT NULL,
  titulo VARCHAR(200) NOT NULL,
  creado_en DATETIME NOT NULL,
  PRIMARY KEY (id_audiencia),
  KEY idx_audiencias_auditoria (id_auditoria),
  CONSTRAINT fk_audiencias_auditoria
    FOREIGN KEY (id_auditoria) REFERENCES auditorias(id_auditoria)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================================
-- 3) SEEDS DETERMINÍSTICOS MASIVOS
--    - 500 empresas
--    - 1000 usuarios
--    - 500 solicitudes_pago
--    - 500 auditorias
--    - 500 evidencias
--    - 500 reportes
--    - 250 conversaciones
--    - 500 mensajes
--    - 500 notificaciones
--    - + tablas puente (empresa_modulos, auditoria_modulos, auditoria_participantes)
-- ==========================================================

-- Base temporal determinística para todas las fechas
SET @seed_base_ts = TIMESTAMP('2026-01-01 00:00:00');

-- ---------- empresas (500)
INSERT INTO empresas (
  id_empresa, id_tipo_empresa, tipo_auditoria,
  nombre, rfc, giro, direccion, ciudad, estado, pais,
  contacto_nombre, contacto_correo, contacto_telefono,
  activo
)
WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 500
)
SELECT
  n AS id_empresa,
  CASE WHEN n <= 100 THEN 1 ELSE 2 END AS id_tipo_empresa,
  CASE (n % 3)
    WHEN 1 THEN 'AMBIENTAL'
    WHEN 2 THEN 'FINANCIERA'
    ELSE 'SEGURIDAD'
  END AS tipo_auditoria,
  CASE WHEN n <= 100
    THEN CONCAT('Auditora ', LPAD(n, 3, '0'))
    ELSE CONCAT('Cliente ', LPAD(n, 3, '0'))
  END AS nombre,
  CASE WHEN n <= 100
    THEN CONCAT('AUD', LPAD(n, 10, '0'))
    ELSE CONCAT('CLI', LPAD(n, 10, '0'))
  END AS rfc,
  CASE WHEN n <= 100 THEN 'Servicios de Auditoría' ELSE 'Industria General' END AS giro,
  CONCAT('Calle ', n, ' #', 100 + (n % 900)) AS direccion,
  CONCAT('Ciudad ', 1 + (n % 60)) AS ciudad,
  CASE ((n - 1) % 3)
    WHEN 0 THEN
      CASE (((n - 1) DIV 3) % 6)
        WHEN 0 THEN 'Baja California'
        WHEN 1 THEN 'Sonora'
        WHEN 2 THEN 'Chihuahua'
        WHEN 3 THEN 'Coahuila'
        WHEN 4 THEN 'Nuevo León'
        ELSE 'Tamaulipas'
      END
    WHEN 1 THEN
      CASE (((n - 1) DIV 3) % 6)
        WHEN 0 THEN 'Jalisco'
        WHEN 1 THEN 'Guanajuato'
        WHEN 2 THEN 'Querétaro'
        WHEN 3 THEN 'Hidalgo'
        WHEN 4 THEN 'Ciudad de México'
        ELSE 'Estado de México'
      END
    ELSE
      CASE (((n - 1) DIV 3) % 6)
        WHEN 0 THEN 'Oaxaca'
        WHEN 1 THEN 'Chiapas'
        WHEN 2 THEN 'Yucatán'
        WHEN 3 THEN 'Quintana Roo'
        WHEN 4 THEN 'Veracruz'
        ELSE 'Guerrero'
      END
  END AS estado,
  'México' AS pais,
  CONCAT('Contacto ', LPAD(n, 3, '0')) AS contacto_nombre,
  CONCAT('contacto', n, '@auditcloud.local') AS contacto_correo,
  CONCAT('+52', LPAD(5500000000 + n, 10, '0')) AS contacto_telefono,
  1 AS activo
FROM seq;

-- ---------- usuarios (1000)
-- Distribución determinística:
-- 1..100   => 100 Supervisores (1 por auditora)
-- 101..300 => 200 Auditores (2 por auditora)
-- 301..700 => 400 Clientes admin (1 por empresa cliente)
-- 701..1000=> 300 Clientes extra (repartidos)
INSERT INTO usuarios (
  id_usuario, id_empresa, nombre, correo, password_hash,
  id_rol, activo, google_id, creado_en
)
WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 1000
)
SELECT
  n AS id_usuario,
  CASE
    WHEN n BETWEEN 1 AND 100 THEN n
    WHEN n BETWEEN 101 AND 300 THEN 1 + ((n - 101) DIV 2)
    WHEN n BETWEEN 301 AND 700 THEN 101 + (n - 301)
    ELSE 101 + ((n - 701) % 400)
  END AS id_empresa,
  CASE
    WHEN n BETWEEN 1 AND 100 THEN CONCAT('Supervisor ', LPAD(n, 3, '0'))
    WHEN n BETWEEN 101 AND 300 THEN CONCAT('Auditor ', LPAD(n, 3, '0'))
    ELSE CONCAT('Cliente ', LPAD(n, 4, '0'))
  END AS nombre,
  CASE
    WHEN n BETWEEN 1 AND 100 THEN CONCAT('supervisor', n, '@auditora', n, '.local')
    WHEN n BETWEEN 101 AND 300 THEN CONCAT('auditor', n, '@auditora', 1 + ((n - 101) DIV 2), '.local')
    ELSE CONCAT('cliente', n, '@cliente',
      CASE
        WHEN n BETWEEN 301 AND 700 THEN 101 + (n - 301)
        ELSE 101 + ((n - 701) % 400)
      END,
    '.local')
  END AS correo,
  CASE WHEN (n % 50) = 0 THEN NULL ELSE '123456' END AS password_hash,
  CASE
    WHEN n BETWEEN 1 AND 100 THEN 1
    WHEN n BETWEEN 101 AND 300 THEN 2
    ELSE 3
  END AS id_rol,
  1 AS activo,
  CASE WHEN (n % 50) = 0 THEN CONCAT('google-', LPAD(n, 6, '0')) ELSE NULL END AS google_id,
  (@seed_base_ts + INTERVAL (n * 37) SECOND) AS creado_en
FROM seq;

-- ---------- empresa_modulos (3 módulos por cada auditora) => 300
INSERT INTO empresa_modulos (id_empresa_modulo, id_empresa, id_modulo, registrado_en)
WITH RECURSIVE seq_emp(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq_emp WHERE n < 100
)
SELECT
  ((e.n - 1) * 3 + m.id_modulo) AS id_empresa_modulo,
  e.n AS id_empresa,
  m.id_modulo,
  (@seed_base_ts + INTERVAL (e.n * 11 + m.id_modulo) MINUTE) AS registrado_en
FROM seq_emp e
CROSS JOIN (
  SELECT 1 AS id_modulo UNION ALL
  SELECT 2 UNION ALL
  SELECT 3
) m;

-- ---------- solicitudes_pago (500) => todas PAGADAS para derivar 500 auditorias
INSERT INTO solicitudes_pago (
  id_solicitud, id_empresa, id_empresa_auditora, id_empresa_cliente, id_cliente,
  monto, concepto, id_estado, creado_en,
  creado_por_supervisor, creado_por_auditor,
  pagada_en, paypal_order_id
)
WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 500
)
SELECT
  n AS id_solicitud,
  (1 + ((n - 1) % 100)) AS id_empresa,
  (1 + ((n - 1) % 100)) AS id_empresa_auditora,
  (101 + ((n - 1) % 400)) AS id_empresa_cliente,
  (301 + ((101 + ((n - 1) % 400)) - 101)) AS id_cliente,
  (1000.00 + (n * 10.00)) AS monto,
  CONCAT('Servicio de auditoría #', n) AS concepto,
  2 AS id_estado,
  (@seed_base_ts + INTERVAL (n * 3) HOUR) AS creado_en,
  CASE WHEN (n % 2) = 1
    THEN (1 + ((n - 1) % 100))
    ELSE NULL
  END AS creado_por_supervisor,
  CASE WHEN (n % 2) = 0
    THEN (101 + (((1 + ((n - 1) % 100)) - 1) * 2))
    ELSE NULL
  END AS creado_por_auditor,
  (@seed_base_ts + INTERVAL (n * 3) HOUR + INTERVAL 1 DAY) AS pagada_en,
  CONCAT('PAYPAL-', LPAD(n, 10, '0')) AS paypal_order_id
FROM seq;

-- ---------- auditorias (500) (derivadas de solicitudes_pago)
INSERT INTO auditorias (
  id_auditoria, id_empresa_auditora, id_cliente, id_solicitud_pago,
  id_estado, monto, creada_en, objetivo, estado_actualizado_en, fecha_inicio
)
WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 500
)
SELECT
  n AS id_auditoria,
  sp.id_empresa_auditora,
  sp.id_cliente,
  sp.id_solicitud,
  (1 + ((n - 1) % 3)) AS id_estado,
  sp.monto,
  (sp.pagada_en) AS creada_en,
  CONCAT('Objetivo auditoría ', n, ': verificación integral') AS objetivo,
  (sp.pagada_en + INTERVAL 2 HOUR) AS estado_actualizado_en,
  DATE(sp.pagada_en) AS fecha_inicio
FROM solicitudes_pago sp
JOIN seq ON seq.n = sp.id_solicitud;

-- ---------- auditoria_participantes (500) (1 auditor por auditoría)
INSERT INTO auditoria_participantes (id_participante, id_auditoria, id_auditor, asignado_en)
WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 500
)
SELECT
  n AS id_participante,
  n AS id_auditoria,
  (101 + ((n - 1) % 200)) AS id_auditor,
  (@seed_base_ts + INTERVAL (n * 5) HOUR) AS asignado_en
FROM seq;

-- ---------- auditoria_modulos (1000) (2 módulos por auditoría)
INSERT INTO auditoria_modulos (id_auditoria_modulo, id_auditoria, id_modulo, registrado_en)
WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 500
)
SELECT
  (n * 2) - 1 AS id_auditoria_modulo,
  n AS id_auditoria,
  (1 + ((n - 1) % 3)) AS id_modulo,
  (@seed_base_ts + INTERVAL (n * 13) MINUTE) AS registrado_en
FROM seq
UNION ALL
SELECT
  (n * 2) AS id_auditoria_modulo,
  n AS id_auditoria,
  (1 + (n % 3)) AS id_modulo,
  (@seed_base_ts + INTERVAL (n * 13 + 1) MINUTE) AS registrado_en
FROM seq;

-- ---------- conversaciones (250)
INSERT INTO conversaciones (
  id_conversacion, id_cliente, id_empresa_auditora,
  asunto, creado_en, ultimo_mensaje_fecha, activo
)
WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 250
)
SELECT
  n AS id_conversacion,
  (301 + ((n - 1) % 400)) AS id_cliente,
  (1 + ((n - 1) % 100)) AS id_empresa_auditora,
  'Consulta General' AS asunto,
  (@seed_base_ts + INTERVAL (n * 17) MINUTE) AS creado_en,
  (@seed_base_ts + INTERVAL (n * 17) MINUTE + INTERVAL 2 HOUR) AS ultimo_mensaje_fecha,
  1 AS activo
FROM seq;

-- ---------- mensajes (500) (alternando CLIENTE/SUPERVISOR)
INSERT INTO mensajes (id_mensaje, id_conversacion, emisor_tipo, emisor_id, contenido, creado_en)
WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 500
)
SELECT
  n AS id_mensaje,
  c.id_conversacion,
  CASE WHEN (n % 2) = 1 THEN 'CLIENTE' ELSE 'SUPERVISOR' END AS emisor_tipo,
  CASE WHEN (n % 2) = 1 THEN c.id_cliente ELSE c.id_empresa_auditora END AS emisor_id,
  CONCAT('Mensaje #', n, ' en conversación #', c.id_conversacion) AS contenido,
  (@seed_base_ts + INTERVAL (n * 29) MINUTE) AS creado_en
FROM seq
JOIN conversaciones c
  ON c.id_conversacion = (1 + ((seq.n - 1) % 250));

-- ---------- evidencias (500)
INSERT INTO evidencias (
  id_evidencia, id_auditoria, id_modulo, id_auditor,
  tipo, descripcion, nombre_archivo, url_archivo,
  creado_en, actualizado_en
)
WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 500
)
SELECT
  n AS id_evidencia,
  (1 + ((n - 1) % 500)) AS id_auditoria,
  (1 + ((n - 1) % 3)) AS id_modulo,
  (101 + (((1 + ((n - 1) % 500)) - 1) % 200)) AS id_auditor,
  CASE (n % 3)
    WHEN 1 THEN 'PDF'
    WHEN 2 THEN 'IMG'
    ELSE 'COMENTARIO'
  END AS tipo,
  CONCAT('Evidencia #', n, ' para auditoría #', (1 + ((n - 1) % 500))) AS descripcion,
  CASE (n % 3)
    WHEN 1 THEN CONCAT('evi-', LPAD(n, 6, '0'), '.pdf')
    WHEN 2 THEN CONCAT('evi-', LPAD(n, 6, '0'), '.png')
    ELSE NULL
  END AS nombre_archivo,
  CASE (n % 3)
    WHEN 1 THEN CONCAT('/uploads/evi-', LPAD(n, 6, '0'), '.pdf')
    WHEN 2 THEN CONCAT('/uploads/evi-', LPAD(n, 6, '0'), '.png')
    ELSE NULL
  END AS url_archivo,
  (@seed_base_ts + INTERVAL (n * 41) MINUTE) AS creado_en,
  (@seed_base_ts + INTERVAL (n * 41) MINUTE + INTERVAL 1 HOUR) AS actualizado_en
FROM seq;

-- ---------- comentarios (500) (para timeline)
INSERT INTO comentarios (id_comentario, id_auditoria, id_usuario, mensaje, creado_en)
WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 500
)
SELECT
  n AS id_comentario,
  (1 + ((n - 1) % 500)) AS id_auditoria,
  (101 + ((n - 1) % 200)) AS id_usuario,
  CONCAT('Comentario #', n, ' sobre auditoría #', (1 + ((n - 1) % 500))) AS mensaje,
  (@seed_base_ts + INTERVAL (n * 19) MINUTE) AS creado_en
FROM seq;

-- ---------- reportes (500) (1 por auditoría)
INSERT INTO reportes (
  id_reporte, id_auditoria, nombre, tipo, observaciones,
  url, nombre_archivo, creado_por, fecha_creacion
)
WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 500
)
SELECT
  n AS id_reporte,
  n AS id_auditoria,
  CONCAT('Reporte Final #', n) AS nombre,
  'FINAL' AS tipo,
  CONCAT('Observaciones determinísticas para auditoría #', n) AS observaciones,
  CONCAT('/uploads/reporte-', LPAD(n, 6, '0'), '.pdf') AS url,
  CONCAT('reporte-', LPAD(n, 6, '0'), '.pdf') AS nombre_archivo,
  (101 + ((n - 1) % 200)) AS creado_por,
  (@seed_base_ts + INTERVAL (n * 7) HOUR) AS fecha_creacion
FROM seq;

-- ---------- notificaciones (500)
INSERT INTO notificaciones (
  id_notificacion, id_cliente, id_auditoria,
  tipo, titulo, mensaje, fecha, leida
)
WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 500
)
SELECT
  n AS id_notificacion,
  (301 + ((n - 1) % 400)) AS id_cliente,
  CASE WHEN (n % 2) = 0 THEN (1 + ((n - 1) % 500)) ELSE NULL END AS id_auditoria,
  CASE (n % 3)
    WHEN 1 THEN 'evidencia_subida'
    WHEN 2 THEN 'estado_cambiado'
    ELSE 'mensaje_nuevo'
  END AS tipo,
  CASE (n % 3)
    WHEN 1 THEN 'Nueva evidencia subida'
    WHEN 2 THEN 'Estado actualizado'
    ELSE 'Nuevo mensaje'
  END AS titulo,
  CONCAT('Notificación #', n, ' para cliente #', (301 + ((n - 1) % 400))) AS mensaje,
  (@seed_base_ts + INTERVAL (n * 23) MINUTE) AS fecha,
  CASE WHEN (n % 4) = 0 THEN 1 ELSE 0 END AS leida
FROM seq;

-- ---------- participantes (compatibilidad) (100)
INSERT INTO participantes (id_participante, id_empresa, nombre, correo, telefono, cargo, activo, creado_en)
WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 100
)
SELECT
  n AS id_participante,
  (101 + ((n - 1) % 400)) AS id_empresa,
  CONCAT('Participante ', LPAD(n, 3, '0')) AS nombre,
  CONCAT('participante', n, '@cliente.local') AS correo,
  CONCAT('+52', LPAD(5600000000 + n, 10, '0')) AS telefono,
  'Contacto' AS cargo,
  1 AS activo,
  (@seed_base_ts + INTERVAL (n * 31) MINUTE) AS creado_en
FROM seq;

-- ==========================================================
-- 4) VISTAS DE FRAGMENTACIÓN (Lab VIII)
--    Fragmentación primaria: empresas por region + tipo_auditoria
--    Fragmentación derivada: auditorias por region + tipo_auditoria de la empresa cliente
-- ==========================================================

-- Vista base: empresas con columna region (NORTE/CENTRO/SUR)
CREATE OR REPLACE VIEW v_empresas_con_region AS
SELECT
  e.*,
  CASE
    WHEN e.estado IN ('Baja California','Sonora','Chihuahua','Coahuila','Nuevo León','Tamaulipas') THEN 'NORTE'
    WHEN e.estado IN ('Jalisco','Guanajuato','Querétaro','Hidalgo','Ciudad de México','Estado de México') THEN 'CENTRO'
    WHEN e.estado IN ('Oaxaca','Chiapas','Yucatán','Quintana Roo','Veracruz','Guerrero') THEN 'SUR'
    ELSE 'CENTRO'
  END AS region
FROM empresas e;

-- Fragmentos: 3 regiones x 3 tipos
CREATE OR REPLACE VIEW v_empresas_norte_ambiental   AS SELECT * FROM v_empresas_con_region WHERE region='NORTE'  AND tipo_auditoria='AMBIENTAL';
CREATE OR REPLACE VIEW v_empresas_norte_financiera  AS SELECT * FROM v_empresas_con_region WHERE region='NORTE'  AND tipo_auditoria='FINANCIERA';
CREATE OR REPLACE VIEW v_empresas_norte_seguridad   AS SELECT * FROM v_empresas_con_region WHERE region='NORTE'  AND tipo_auditoria='SEGURIDAD';

CREATE OR REPLACE VIEW v_empresas_centro_ambiental  AS SELECT * FROM v_empresas_con_region WHERE region='CENTRO' AND tipo_auditoria='AMBIENTAL';
CREATE OR REPLACE VIEW v_empresas_centro_financiera AS SELECT * FROM v_empresas_con_region WHERE region='CENTRO' AND tipo_auditoria='FINANCIERA';
CREATE OR REPLACE VIEW v_empresas_centro_seguridad  AS SELECT * FROM v_empresas_con_region WHERE region='CENTRO' AND tipo_auditoria='SEGURIDAD';

CREATE OR REPLACE VIEW v_empresas_sur_ambiental     AS SELECT * FROM v_empresas_con_region WHERE region='SUR'    AND tipo_auditoria='AMBIENTAL';
CREATE OR REPLACE VIEW v_empresas_sur_financiera    AS SELECT * FROM v_empresas_con_region WHERE region='SUR'    AND tipo_auditoria='FINANCIERA';
CREATE OR REPLACE VIEW v_empresas_sur_seguridad     AS SELECT * FROM v_empresas_con_region WHERE region='SUR'    AND tipo_auditoria='SEGURIDAD';

-- Vistas simples Lab VIII (por región)
CREATE OR REPLACE VIEW empresas_norte  AS SELECT * FROM v_empresas_con_region WHERE region='NORTE';
CREATE OR REPLACE VIEW empresas_centro AS SELECT * FROM v_empresas_con_region WHERE region='CENTRO';
CREATE OR REPLACE VIEW empresas_sur    AS SELECT * FROM v_empresas_con_region WHERE region='SUR';

-- Vistas simples Lab VIII (por tipo_auditoria)
CREATE OR REPLACE VIEW empresas_ambiental  AS SELECT * FROM empresas WHERE tipo_auditoria='AMBIENTAL';
CREATE OR REPLACE VIEW empresas_financiera AS SELECT * FROM empresas WHERE tipo_auditoria='FINANCIERA';
CREATE OR REPLACE VIEW empresas_seguridad  AS SELECT * FROM empresas WHERE tipo_auditoria='SEGURIDAD';

-- Fragmentación derivada: auditorías asignadas al fragmento de la empresa cliente
CREATE OR REPLACE VIEW v_auditorias_con_fragmento AS
SELECT
  a.*, u.id_empresa AS id_empresa_cliente,
  e.tipo_auditoria,
  CASE
    WHEN e.estado IN ('Baja California','Sonora','Chihuahua','Coahuila','Nuevo León','Tamaulipas') THEN 'NORTE'
    WHEN e.estado IN ('Jalisco','Guanajuato','Querétaro','Hidalgo','Ciudad de México','Estado de México') THEN 'CENTRO'
    WHEN e.estado IN ('Oaxaca','Chiapas','Yucatán','Quintana Roo','Veracruz','Guerrero') THEN 'SUR'
    ELSE 'CENTRO'
  END AS region
FROM auditorias a
JOIN usuarios u ON u.id_usuario = a.id_cliente
JOIN empresas e ON e.id_empresa = u.id_empresa;

CREATE OR REPLACE VIEW v_auditorias_norte_ambiental   AS SELECT * FROM v_auditorias_con_fragmento WHERE region='NORTE'  AND tipo_auditoria='AMBIENTAL';
CREATE OR REPLACE VIEW v_auditorias_norte_financiera  AS SELECT * FROM v_auditorias_con_fragmento WHERE region='NORTE'  AND tipo_auditoria='FINANCIERA';
CREATE OR REPLACE VIEW v_auditorias_norte_seguridad   AS SELECT * FROM v_auditorias_con_fragmento WHERE region='NORTE'  AND tipo_auditoria='SEGURIDAD';

CREATE OR REPLACE VIEW v_auditorias_centro_ambiental  AS SELECT * FROM v_auditorias_con_fragmento WHERE region='CENTRO' AND tipo_auditoria='AMBIENTAL';
CREATE OR REPLACE VIEW v_auditorias_centro_financiera AS SELECT * FROM v_auditorias_con_fragmento WHERE region='CENTRO' AND tipo_auditoria='FINANCIERA';
CREATE OR REPLACE VIEW v_auditorias_centro_seguridad  AS SELECT * FROM v_auditorias_con_fragmento WHERE region='CENTRO' AND tipo_auditoria='SEGURIDAD';

CREATE OR REPLACE VIEW v_auditorias_sur_ambiental     AS SELECT * FROM v_auditorias_con_fragmento WHERE region='SUR'    AND tipo_auditoria='AMBIENTAL';
CREATE OR REPLACE VIEW v_auditorias_sur_financiera    AS SELECT * FROM v_auditorias_con_fragmento WHERE region='SUR'    AND tipo_auditoria='FINANCIERA';
CREATE OR REPLACE VIEW v_auditorias_sur_seguridad     AS SELECT * FROM v_auditorias_con_fragmento WHERE region='SUR'    AND tipo_auditoria='SEGURIDAD';

-- Vistas simples Lab VIII (auditorías por región)
CREATE OR REPLACE VIEW auditorias_norte  AS SELECT * FROM v_auditorias_con_fragmento WHERE region='NORTE';
CREATE OR REPLACE VIEW auditorias_centro AS SELECT * FROM v_auditorias_con_fragmento WHERE region='CENTRO';
CREATE OR REPLACE VIEW auditorias_sur    AS SELECT * FROM v_auditorias_con_fragmento WHERE region='SUR';

-- Vistas simples Lab VIII (auditorías por tipo_auditoria)
CREATE OR REPLACE VIEW auditorias_ambiental  AS SELECT * FROM v_auditorias_con_fragmento WHERE tipo_auditoria='AMBIENTAL';
CREATE OR REPLACE VIEW auditorias_financiera AS SELECT * FROM v_auditorias_con_fragmento WHERE tipo_auditoria='FINANCIERA';
CREATE OR REPLACE VIEW auditorias_seguridad  AS SELECT * FROM v_auditorias_con_fragmento WHERE tipo_auditoria='SEGURIDAD';

-- Vista compat para timeline (backend a veces usa e.url en vez de e.url_archivo)
CREATE OR REPLACE VIEW v_evidencias_timeline AS
SELECT
  e.id_evidencia,
  e.id_auditoria,
  e.id_modulo,
  e.id_auditor,
  e.tipo,
  e.descripcion,
  e.nombre_archivo,
  e.url_archivo AS url,
  e.creado_en,
  e.actualizado_en
FROM evidencias e;

-- ==========================================================
-- 5) SECCIÓN FINAL: VERIFICACIÓN + JOINS
-- ==========================================================

-- ==========================================================
-- 5) VALIDACIÓN (se ejecuta al final)
-- ==========================================================

SHOW TABLES;

-- Conteos mínimos requeridos
SELECT 'empresas' AS tabla, COUNT(*) AS total FROM empresas
UNION ALL SELECT 'usuarios', COUNT(*) FROM usuarios
UNION ALL SELECT 'solicitudes_pago', COUNT(*) FROM solicitudes_pago
UNION ALL SELECT 'auditorias', COUNT(*) FROM auditorias
UNION ALL SELECT 'evidencias', COUNT(*) FROM evidencias
UNION ALL SELECT 'reportes', COUNT(*) FROM reportes
UNION ALL SELECT 'conversaciones', COUNT(*) FROM conversaciones
UNION ALL SELECT 'mensajes', COUNT(*) FROM mensajes
UNION ALL SELECT 'notificaciones', COUNT(*) FROM notificaciones;

-- Distribución por rol
SELECT r.nombre AS rol, COUNT(*) AS total
FROM usuarios u
JOIN roles r ON r.id_rol = u.id_rol
GROUP BY r.nombre
ORDER BY r.id_rol;

-- Conteos por vistas simples Lab VIII (empresas)
SELECT 'empresas_norte' AS vista, COUNT(*) AS total FROM empresas_norte
UNION ALL SELECT 'empresas_centro', COUNT(*) FROM empresas_centro
UNION ALL SELECT 'empresas_sur', COUNT(*) FROM empresas_sur
UNION ALL SELECT 'empresas_ambiental', COUNT(*) FROM empresas_ambiental
UNION ALL SELECT 'empresas_financiera', COUNT(*) FROM empresas_financiera
UNION ALL SELECT 'empresas_seguridad', COUNT(*) FROM empresas_seguridad;

-- Conteos por vistas simples Lab VIII (auditorías)
SELECT 'auditorias_norte' AS vista, COUNT(*) AS total FROM auditorias_norte
UNION ALL SELECT 'auditorias_centro', COUNT(*) FROM auditorias_centro
UNION ALL SELECT 'auditorias_sur', COUNT(*) FROM auditorias_sur
UNION ALL SELECT 'auditorias_ambiental', COUNT(*) FROM auditorias_ambiental
UNION ALL SELECT 'auditorias_financiera', COUNT(*) FROM auditorias_financiera
UNION ALL SELECT 'auditorias_seguridad', COUNT(*) FROM auditorias_seguridad;

-- Distribución de fragmentación (empresas por región+tipo)
SELECT region, tipo_auditoria, COUNT(*) AS total
FROM v_empresas_con_region
GROUP BY region, tipo_auditoria
ORDER BY region, tipo_auditoria;

-- Verificar suma de fragmentos combinados (empresas)
SELECT COUNT(*) AS total_empresas FROM empresas;
SELECT (
  (SELECT COUNT(*) FROM v_empresas_norte_ambiental) +
  (SELECT COUNT(*) FROM v_empresas_norte_financiera) +
  (SELECT COUNT(*) FROM v_empresas_norte_seguridad) +
  (SELECT COUNT(*) FROM v_empresas_centro_ambiental) +
  (SELECT COUNT(*) FROM v_empresas_centro_financiera) +
  (SELECT COUNT(*) FROM v_empresas_centro_seguridad) +
  (SELECT COUNT(*) FROM v_empresas_sur_ambiental) +
  (SELECT COUNT(*) FROM v_empresas_sur_financiera) +
  (SELECT COUNT(*) FROM v_empresas_sur_seguridad)
) AS suma_fragmentos_empresas;

-- Distribución de fragmentación derivada (auditorías por empresa cliente)
SELECT region, tipo_auditoria, COUNT(*) AS total
FROM v_auditorias_con_fragmento
GROUP BY region, tipo_auditoria
ORDER BY region, tipo_auditoria;

-- Join principal: solicitud_pago -> auditoria -> empresa auditora + cliente + empresa cliente
SELECT
  sp.id_solicitud,
  sp.monto,
  sp.concepto,
  sp.id_estado AS estado_solicitud,
  a.id_auditoria,
  a.id_estado AS estado_auditoria,
  ea.nombre AS empresa_auditora,
  uc.nombre AS cliente_nombre,
  ec.nombre AS empresa_cliente
FROM solicitudes_pago sp
JOIN auditorias a ON a.id_solicitud_pago = sp.id_solicitud
JOIN empresas ea ON ea.id_empresa = sp.id_empresa_auditora
JOIN usuarios uc ON uc.id_usuario = sp.id_cliente
JOIN empresas ec ON ec.id_empresa = uc.id_empresa
ORDER BY sp.id_solicitud
LIMIT 20;

-- Join para timeline (evidencias + comentarios por auditoría)
SELECT
  a.id_auditoria,
  COUNT(DISTINCT e.id_evidencia) AS evidencias,
  COUNT(DISTINCT c.id_comentario) AS comentarios
FROM auditorias a
LEFT JOIN evidencias e ON e.id_auditoria = a.id_auditoria
LEFT JOIN comentarios c ON c.id_auditoria = a.id_auditoria
GROUP BY a.id_auditoria
ORDER BY a.id_auditoria
LIMIT 20;
