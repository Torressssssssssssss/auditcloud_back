-- Generado por docker/mysql/generar_esquema.py para volúmenes nuevos.
-- Incluye solo esquema y catálogos, sin datos de usuarios ni DROP DATABASE.
SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION';
USE auditcloud_db;


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
  UNIQUE KEY uq_auditorias_solicitud_pago (id_solicitud_pago),
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

CREATE TABLE consumos_ambientales (
  id_evidencia INT NOT NULL,
  tipo_recurso VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  cantidad DECIMAL(15,3) NOT NULL,
  unidad_medida VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  PRIMARY KEY (id_evidencia),
  KEY idx_consumos_recurso_periodo (tipo_recurso, fecha_inicio, fecha_fin),
  CONSTRAINT fk_consumos_evidencia FOREIGN KEY (id_evidencia)
    REFERENCES evidencias (id_evidencia) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT ck_consumos_cantidad CHECK (cantidad >= 0),
  CONSTRAINT ck_consumos_periodo CHECK (
    fecha_inicio >= '1000-01-01' AND fecha_fin >= fecha_inicio
    AND MONTH(fecha_inicio) > 0 AND MONTH(fecha_fin) > 0
    AND DAYOFMONTH(fecha_inicio) > 0 AND DAYOFMONTH(fecha_fin) > 0
    AND DAYOFMONTH(fecha_inicio) <= DAYOFMONTH(LAST_DAY(fecha_inicio))
    AND DAYOFMONTH(fecha_fin) <= DAYOFMONTH(LAST_DAY(fecha_fin))
  ),
  CONSTRAINT ck_consumos_recurso_unidad CHECK (
    (tipo_recurso = 'Agua' AND unidad_medida IN ('L', 'm3')) OR
    (tipo_recurso = 'Energía' AND unidad_medida IN ('kWh', 'MWh')) OR
    (tipo_recurso = 'Residuos' AND unidad_medida IN ('kg', 't')) OR
    (tipo_recurso = 'Emisiones' AND unidad_medida IN ('kgCO2e', 'tCO2e'))
  )
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

CREATE TABLE IF NOT EXISTS app_sequences (
  entity varchar(64) NOT NULL PRIMARY KEY,
  last_id bigint unsigned NOT NULL
) ENGINE=InnoDB;
ALTER TABLE conversaciones
  ADD COLUMN tipo_conversacion varchar(20) NOT NULL DEFAULT 'COMERCIAL',
  ADD COLUMN id_auditoria int NULL,
  ADD COLUMN id_usuario_supervisor int NULL,
  ADD COLUMN id_usuario_auditor int NULL,
  ADD COLUMN estado varchar(20) NOT NULL DEFAULT 'ABIERTA',
  ADD CONSTRAINT fk_conv_auditoria FOREIGN KEY (id_auditoria) REFERENCES auditorias(id_auditoria),
  ADD CONSTRAINT fk_conv_supervisor FOREIGN KEY (id_usuario_supervisor) REFERENCES usuarios(id_usuario),
  ADD CONSTRAINT fk_conv_auditor FOREIGN KEY (id_usuario_auditor) REFERENCES usuarios(id_usuario);
ALTER TABLE auditorias
  ADD COLUMN creado_por_supervisor int NULL,
  ADD CONSTRAINT fk_audit_creador FOREIGN KEY (creado_por_supervisor) REFERENCES usuarios(id_usuario);
ALTER TABLE solicitudes_pago
  ADD COLUMN mercadopago_payment_id varchar(100) NULL,
  ADD COLUMN id_preferencia varchar(150) NULL,
  ADD COLUMN mercadopago_external_reference varchar(150) NULL,
  ADD COLUMN mercadopago_metadata_id_solicitud_pago varchar(100) NULL,
  ADD COLUMN mercadopago_status varchar(50) NULL,
  ADD COLUMN mercadopago_status_detail varchar(150) NULL,
  ADD COLUMN mercadopago_payment_method_id varchar(100) NULL,
  ADD COLUMN mercadopago_payment_type_id varchar(100) NULL,
  ADD COLUMN mercadopago_transaction_amount decimal(12,2) NULL,
  ADD COLUMN mercadopago_actualizado_en datetime NULL,
  ADD COLUMN mercadopago_preference_created_at datetime NULL,
  ADD UNIQUE KEY uq_mp_payment (mercadopago_payment_id);

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

CREATE OR REPLACE VIEW v_empresas_norte_ambiental   AS SELECT * FROM v_empresas_con_region WHERE region='NORTE'  AND tipo_auditoria='AMBIENTAL';

CREATE OR REPLACE VIEW v_empresas_norte_financiera  AS SELECT * FROM v_empresas_con_region WHERE region='NORTE'  AND tipo_auditoria='FINANCIERA';

CREATE OR REPLACE VIEW v_empresas_norte_seguridad   AS SELECT * FROM v_empresas_con_region WHERE region='NORTE'  AND tipo_auditoria='SEGURIDAD';

CREATE OR REPLACE VIEW v_empresas_centro_ambiental  AS SELECT * FROM v_empresas_con_region WHERE region='CENTRO' AND tipo_auditoria='AMBIENTAL';

CREATE OR REPLACE VIEW v_empresas_centro_financiera AS SELECT * FROM v_empresas_con_region WHERE region='CENTRO' AND tipo_auditoria='FINANCIERA';

CREATE OR REPLACE VIEW v_empresas_centro_seguridad  AS SELECT * FROM v_empresas_con_region WHERE region='CENTRO' AND tipo_auditoria='SEGURIDAD';

CREATE OR REPLACE VIEW v_empresas_sur_ambiental     AS SELECT * FROM v_empresas_con_region WHERE region='SUR'    AND tipo_auditoria='AMBIENTAL';

CREATE OR REPLACE VIEW v_empresas_sur_financiera    AS SELECT * FROM v_empresas_con_region WHERE region='SUR'    AND tipo_auditoria='FINANCIERA';

CREATE OR REPLACE VIEW v_empresas_sur_seguridad     AS SELECT * FROM v_empresas_con_region WHERE region='SUR'    AND tipo_auditoria='SEGURIDAD';

CREATE OR REPLACE VIEW empresas_norte  AS SELECT * FROM v_empresas_con_region WHERE region='NORTE';

CREATE OR REPLACE VIEW empresas_centro AS SELECT * FROM v_empresas_con_region WHERE region='CENTRO';

CREATE OR REPLACE VIEW empresas_sur    AS SELECT * FROM v_empresas_con_region WHERE region='SUR';

CREATE OR REPLACE VIEW empresas_ambiental  AS SELECT * FROM empresas WHERE tipo_auditoria='AMBIENTAL';

CREATE OR REPLACE VIEW empresas_financiera AS SELECT * FROM empresas WHERE tipo_auditoria='FINANCIERA';

CREATE OR REPLACE VIEW empresas_seguridad  AS SELECT * FROM empresas WHERE tipo_auditoria='SEGURIDAD';

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

CREATE OR REPLACE VIEW auditorias_norte  AS SELECT * FROM v_auditorias_con_fragmento WHERE region='NORTE';

CREATE OR REPLACE VIEW auditorias_centro AS SELECT * FROM v_auditorias_con_fragmento WHERE region='CENTRO';

CREATE OR REPLACE VIEW auditorias_sur    AS SELECT * FROM v_auditorias_con_fragmento WHERE region='SUR';

CREATE OR REPLACE VIEW auditorias_ambiental  AS SELECT * FROM v_auditorias_con_fragmento WHERE tipo_auditoria='AMBIENTAL';

CREATE OR REPLACE VIEW auditorias_financiera AS SELECT * FROM v_auditorias_con_fragmento WHERE tipo_auditoria='FINANCIERA';

CREATE OR REPLACE VIEW auditorias_seguridad  AS SELECT * FROM v_auditorias_con_fragmento WHERE tipo_auditoria='SEGURIDAD';

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
