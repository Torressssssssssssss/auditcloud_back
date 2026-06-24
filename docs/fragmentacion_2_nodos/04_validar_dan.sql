-- Validacion del fragmento Dan Norte-Sur.

SHOW DATABASES LIKE 'auditcloud_frag_dan';

SELECT * FROM auditcloud_frag_dan.fragmentacion_info;
SELECT * FROM auditcloud_frag_dan.v_resumen_fragmento;
SELECT * FROM auditcloud_frag_dan.v_empresas_por_estado ORDER BY estado;

-- Debe devolver cero.
SELECT COUNT(*) AS empresas_fuera_de_norte_sur
FROM auditcloud_frag_dan.empresas
WHERE estado NOT IN (
  'NL','Nuevo León','Coahuila','Chihuahua','Sonora','BC','Baja California',
  'Sinaloa','Durango','Tamaulipas','Zacatecas',
  'Puebla','Oaxaca','Guerrero','QRoo','Quintana Roo','Veracruz','Yucatán',
  'Campeche','Tabasco','Chiapas'
);

-- Debe devolver cero.
SELECT COUNT(*) AS empresas_centro_en_dan
FROM auditcloud_frag_dan.empresas
WHERE estado IN (
  'CDMX','Ciudad de México','AGS','Aguascalientes','Jalisco','Guanajuato',
  'Michoacán','SLP','San Luis Potosí','Hidalgo','EdoMex','Estado de México',
  'Querétaro','Morelos','Colima','Nayarit','Tlaxcala'
);

-- Debe devolver cero.
SELECT COUNT(*) AS auditorias_sin_empresa_norte_sur
FROM auditcloud_frag_dan.auditorias a
LEFT JOIN auditcloud_frag_dan.solicitudes_pago sp
  ON sp.id_solicitud = a.id_solicitud_pago
LEFT JOIN auditcloud_frag_dan.empresas e
  ON e.id_empresa = COALESCE(sp.id_empresa_cliente, sp.id_empresa)
WHERE e.id_empresa IS NULL;

-- Catalogos replicados: comparar contra auditcloud_db local de Dan.
SELECT 'roles' catalogo, (SELECT COUNT(*) FROM auditcloud_db.roles) origen, (SELECT COUNT(*) FROM auditcloud_frag_dan.roles) fragmento
UNION ALL SELECT 'tipos_empresa', (SELECT COUNT(*) FROM auditcloud_db.tipos_empresa), (SELECT COUNT(*) FROM auditcloud_frag_dan.tipos_empresa)
UNION ALL SELECT 'estados_auditoria', (SELECT COUNT(*) FROM auditcloud_db.estados_auditoria), (SELECT COUNT(*) FROM auditcloud_frag_dan.estados_auditoria)
UNION ALL SELECT 'estados_solicitud_pago', (SELECT COUNT(*) FROM auditcloud_db.estados_solicitud_pago), (SELECT COUNT(*) FROM auditcloud_frag_dan.estados_solicitud_pago)
UNION ALL SELECT 'tipos_auditoria', (SELECT COUNT(*) FROM auditcloud_db.tipos_auditoria), (SELECT COUNT(*) FROM auditcloud_frag_dan.tipos_auditoria)
UNION ALL SELECT 'modulos_ambientales', (SELECT COUNT(*) FROM auditcloud_db.modulos_ambientales), (SELECT COUNT(*) FROM auditcloud_frag_dan.modulos_ambientales);

-- Completitud local esperada respecto al criterio Norte-Sur.
SELECT
  (SELECT COUNT(*) FROM auditcloud_db.empresas WHERE estado IN (
    'NL','Nuevo León','Coahuila','Chihuahua','Sonora','BC','Baja California',
    'Sinaloa','Durango','Tamaulipas','Zacatecas',
    'Puebla','Oaxaca','Guerrero','QRoo','Quintana Roo','Veracruz','Yucatán',
    'Campeche','Tabasco','Chiapas'
  )) AS empresas_norte_sur_en_origen,
  (SELECT COUNT(*) FROM auditcloud_frag_dan.empresas) AS empresas_norte_sur_fragmento;
