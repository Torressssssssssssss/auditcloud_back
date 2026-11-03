from pathlib import Path
import re


def generar_esquema():
    raiz = Path(__file__).resolve().parents[2]
    base = (raiz / 'auditcloud_back/auditcloud_db.sql').read_text(encoding='utf-8')
    tablas = re.findall(r'^CREATE TABLE \w+ \([\s\S]*?^\) ENGINE=[^;]+;', base, re.MULTILINE)
    catalogos = re.findall(
        r'^INSERT INTO (?:roles|tipos_empresa|tipos_auditoria|estados_auditoria|estados_solicitud_pago|modulos_ambientales)\b[^;]+;',
        base, re.MULTILINE)
    vistas = re.findall(r'^CREATE OR REPLACE VIEW\b[^;]+;', base, re.MULTILINE)
    migracion = (raiz / 'auditcloud_back/migrations/20260907_mysql_only.sql').read_text(encoding='utf-8')
    migracion = re.sub(r'^--[^\n]*\n', '', migracion, flags=re.MULTILINE)
    duplicado = 'ALTER TABLE auditorias\n  ADD UNIQUE KEY uq_auditorias_solicitud_pago (id_solicitud_pago);'
    if('UNIQUE KEY uq_auditorias_solicitud_pago (id_solicitud_pago)' in base):
        migracion = migracion.replace(duplicado, '')
    if not tablas or len(catalogos) != 6 or not vistas or duplicado in migracion:
        raise ValueError('El esquema de origen cambió; revisar la inicialización Docker.')
    cabecera = (
        '-- Generado por docker/mysql/generar_esquema.py para volúmenes nuevos.\n'
        '-- Incluye solo esquema y catálogos, sin datos de usuarios ni DROP DATABASE.\n'
        'SET NAMES utf8mb4;\n'
        "SET time_zone = '+00:00';\n"
        "SET sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,NO_ENGINE_SUBSTITUTION';\n"
        'USE auditcloud_db;\n'
    )
    contenido = '\n\n'.join([cabecera, *tablas, *catalogos, migracion.strip(), *vistas]) + '\n'
    (Path(__file__).parent / '01_esquema.sql').write_text(contenido, encoding='utf-8')
    print(f'Esquema generado: {len(tablas)} tablas base, app_sequences, {len(catalogos)} catálogos y {len(vistas)} vistas.')


if __name__ == '__main__':
    generar_esquema()
