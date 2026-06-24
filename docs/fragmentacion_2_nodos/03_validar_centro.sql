-- Validacion del fragmento local Centro.

SHOW DATABASES LIKE 'auditcloud_frag_centro';

SELECT * FROM auditcloud_frag_centro.fragmentacion_info;
SELECT * FROM auditcloud_frag_centro.v_resumen_fragmento;
SELECT * FROM auditcloud_frag_centro.v_empresas_por_estado ORDER BY estado;

-- Debe devolver cero.
SELECT COUNT(*) AS empresas_fuera_de_centro
FROM auditcloud_frag_centro.empresas
WHERE estado NOT IN (
  'CDMX','Ciudad de México','AGS','Aguascalientes','Jalisco','Guanajuato',
  'Michoacán','SLP','San Luis Potosí','Hidalgo','EdoMex','Estado de México',
  'Querétaro','Morelos','Colima','Nayarit','Tlaxcala'
);

-- Debe devolver cero.
SELECT COUNT(*) AS auditorias_sin_empresa_centro
FROM auditcloud_frag_centro.auditorias a
LEFT JOIN auditcloud_frag_centro.solicitudes_pago sp
  ON sp.id_solicitud = a.id_solicitud_pago
LEFT JOIN auditcloud_frag_centro.empresas e
  ON e.id_empresa = COALESCE(sp.id_empresa_cliente, sp.id_empresa)
WHERE e.id_empresa IS NULL;

-- Catalogos replicados: comparar contra auditcloud_db.
SELECT 'roles' catalogo, (SELECT COUNT(*) FROM auditcloud_db.roles) origen, (SELECT COUNT(*) FROM auditcloud_frag_centro.roles) fragmento
UNION ALL SELECT 'tipos_empresa', (SELECT COUNT(*) FROM auditcloud_db.tipos_empresa), (SELECT COUNT(*) FROM auditcloud_frag_centro.tipos_empresa)
UNION ALL SELECT 'estados_auditoria', (SELECT COUNT(*) FROM auditcloud_db.estados_auditoria), (SELECT COUNT(*) FROM auditcloud_frag_centro.estados_auditoria)
UNION ALL SELECT 'estados_solicitud_pago', (SELECT COUNT(*) FROM auditcloud_db.estados_solicitud_pago), (SELECT COUNT(*) FROM auditcloud_frag_centro.estados_solicitud_pago)
UNION ALL SELECT 'tipos_auditoria', (SELECT COUNT(*) FROM auditcloud_db.tipos_auditoria), (SELECT COUNT(*) FROM auditcloud_frag_centro.tipos_auditoria)
UNION ALL SELECT 'modulos_ambientales', (SELECT COUNT(*) FROM auditcloud_db.modulos_ambientales), (SELECT COUNT(*) FROM auditcloud_frag_centro.modulos_ambientales);

-- Completitud local esperada respecto al criterio Centro.
SELECT
  (SELECT COUNT(*) FROM auditcloud_db.empresas WHERE estado IN (
    'CDMX','Ciudad de México','AGS','Aguascalientes','Jalisco','Guanajuato',
    'Michoacán','SLP','San Luis Potosí','Hidalgo','EdoMex','Estado de México',
    'Querétaro','Morelos','Colima','Nayarit','Tlaxcala'
  )) AS empresas_centro_en_origen,
  (SELECT COUNT(*) FROM auditcloud_frag_centro.empresas) AS empresas_centro_fragmento;
