-- Consultas para demostrar reconstruccion logica de fragmentos.
-- Ejecutar en un entorno que pueda consultar ambas bases, o ejecutar las partes
-- equivalentes en cada nodo y comparar resultados.

-- En nodo Centro:
SELECT COUNT(*) AS empresas_centro FROM auditcloud_frag_centro.empresas;
SELECT MIN(id_empresa) AS min_id, MAX(id_empresa) AS max_id FROM auditcloud_frag_centro.empresas;

-- En nodo Dan:
-- SELECT COUNT(*) AS empresas_dan FROM auditcloud_frag_dan.empresas;
-- SELECT MIN(id_empresa) AS min_id, MAX(id_empresa) AS max_id FROM auditcloud_frag_dan.empresas;

-- Total esperado en auditcloud_db por los predicados usados:
SELECT
  SUM(estado IN (
    'CDMX','Ciudad de México','AGS','Aguascalientes','Jalisco','Guanajuato',
    'Michoacán','SLP','San Luis Potosí','Hidalgo','EdoMex','Estado de México',
    'Querétaro','Morelos','Colima','Nayarit','Tlaxcala'
  )) AS empresas_centro_esperadas,
  SUM(estado IN (
    'NL','Nuevo León','Coahuila','Chihuahua','Sonora','BC','Baja California',
    'Sinaloa','Durango','Tamaulipas','Zacatecas',
    'Puebla','Oaxaca','Guerrero','QRoo','Quintana Roo','Veracruz','Yucatán',
    'Campeche','Tabasco','Chiapas'
  )) AS empresas_dan_esperadas,
  COUNT(*) AS empresas_total_origen
FROM auditcloud_db.empresas;

-- Disjuncion: no debe existir id_empresa en ambos nodos.
-- Si ambas bases estan accesibles desde el mismo servidor:
-- SELECT COUNT(*) AS traslape
-- FROM auditcloud_frag_centro.empresas c
-- JOIN auditcloud_frag_dan.empresas d ON d.id_empresa = c.id_empresa;

-- Completitud: empresas_centro + empresas_dan debe igualar empresas_total_origen
-- para los estados incluidos por el laboratorio.
