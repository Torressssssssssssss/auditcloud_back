-- Compatible con instalaciones previas; los esquemas de instalación ya permiten NULL.
ALTER TABLE empresas MODIFY COLUMN rfc VARCHAR(20) NULL DEFAULT NULL;
UPDATE empresas SET rfc = NULL WHERE TRIM(rfc) = '';
