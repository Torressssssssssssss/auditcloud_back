-- AC-01. MySQL >= 8.0.16: requiere CHECK constraints efectivas.
-- Aplicar sobre auditcloud_db antes de desplegar el backend.
-- Una evidencia admite cero o un consumo; se preservan las evidencias existentes.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS consumos_ambientales (
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
