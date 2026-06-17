// Escrituras post-creacion de auditorias con MySQL como fuente principal.
const { getPool } = require('./db');
const { readJson, writeJson } = require('./jsonDb');

const AUDITORIA_FINALIZADA = 3;

function toDate(value) {
  if (!value) return new Date();
  if (value instanceof Date) return value;

  const normalized = String(value).includes('T')
    ? String(value)
    : String(value).replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function toIsoDateTime(value) {
  return toDate(value).toISOString();
}

function toMysqlDateTime(value) {
  return toIsoDateTime(value).slice(0, 19).replace('T', ' ');
}

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function buildError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeAuditoria(row = {}) {
  return {
    ...row,
    id_auditoria: Number(row.id_auditoria),
    id_empresa_auditora: Number(row.id_empresa_auditora),
    id_cliente: Number(row.id_cliente),
    id_solicitud_pago: Number(row.id_solicitud_pago),
    id_estado: Number(row.id_estado),
    monto: Number(row.monto),
    creada_en: toIsoDateTime(row.creada_en),
    objetivo: row.objetivo || null,
    estado_actualizado_en: row.estado_actualizado_en ? toIsoDateTime(row.estado_actualizado_en) : null,
    fecha_inicio: toDateOnly(row.fecha_inicio)
  };
}

function normalizeReporte(row = {}) {
  return {
    ...row,
    id_reporte: Number(row.id_reporte),
    id_auditoria: Number(row.id_auditoria),
    nombre: row.nombre,
    tipo: row.tipo,
    observaciones: row.observaciones || '',
    url: row.url,
    nombre_archivo: row.nombre_archivo,
    creado_por: Number(row.creado_por),
    fecha_creacion: toIsoDateTime(row.fecha_creacion)
  };
}

function normalizeParticipante(row = {}) {
  return {
    ...row,
    id_participante: Number(row.id_participante),
    id_auditoria: Number(row.id_auditoria),
    id_auditor: Number(row.id_auditor),
    asignado_en: toIsoDateTime(row.asignado_en)
  };
}

function normalizeModulo(row = {}) {
  return {
    ...row,
    id_auditoria_modulo: Number(row.id_auditoria_modulo),
    id_auditoria: Number(row.id_auditoria),
    id_modulo: Number(row.id_modulo),
    registrado_en: toIsoDateTime(row.registrado_en)
  };
}

async function acquireLock(connection, lockName) {
  const [rows] = await connection.execute('SELECT GET_LOCK(?, 10) AS locked;', [lockName]);
  if (Number(rows[0]?.locked) !== 1) {
    throw buildError('AUDITORIA_LOCK_TIMEOUT', `No fue posible tomar lock ${lockName}.`);
  }
}

async function releaseLock(connection, lockName) {
  try {
    await connection.execute('SELECT RELEASE_LOCK(?) AS released;', [lockName]);
  } catch (error) {
    console.error(`Error liberando lock ${lockName}:`, error);
  }
}

async function selectAuditoriaForUpdate(connection, idAuditoria) {
  const [rows] = await connection.execute(
    `SELECT
      id_auditoria,
      id_empresa_auditora,
      id_cliente,
      id_solicitud_pago,
      id_estado,
      monto,
      creada_en,
      objetivo,
      estado_actualizado_en,
      fecha_inicio
    FROM auditorias
    WHERE id_auditoria = ?
    LIMIT 1
    FOR UPDATE;`,
    [Number(idAuditoria)]
  );

  if (!rows[0]) {
    throw buildError('AUDITORIA_NOT_FOUND', 'Auditoria no encontrada en MySQL.');
  }

  return normalizeAuditoria(rows[0]);
}

function assertEmpresaAuditora(auditoria, idEmpresaAuditora) {
  if (
    idEmpresaAuditora !== undefined &&
    idEmpresaAuditora !== null &&
    Number(auditoria.id_empresa_auditora) !== Number(idEmpresaAuditora)
  ) {
    throw buildError('AUDITORIA_FORBIDDEN', 'No tienes permiso para modificar esta auditoria.');
  }
}

async function createReporteFinalAndFinalizeMysql({
  idAuditoria,
  nombre,
  observaciones = '',
  url,
  nombreArchivo,
  creadoPor
}) {
  const pool = getPool();
  const connection = await pool.getConnection();
  const lockName = 'auditcloud:reportes:create';
  let transactionStarted = false;
  let lockAcquired = false;

  try {
    await acquireLock(connection, lockName);
    lockAcquired = true;
    await connection.beginTransaction();
    transactionStarted = true;

    const auditoria = await selectAuditoriaForUpdate(connection, idAuditoria);
    const creadoEn = toMysqlDateTime(new Date());
    const [idRows] = await connection.execute('SELECT COALESCE(MAX(id_reporte), 0) + 1 AS nextId FROM reportes;');
    const idReporte = Number(idRows[0].nextId);

    await connection.execute(
      `INSERT INTO reportes (
        id_reporte,
        id_auditoria,
        nombre,
        tipo,
        observaciones,
        url,
        nombre_archivo,
        creado_por,
        fecha_creacion
      ) VALUES (?, ?, ?, 'FINAL', ?, ?, ?, ?, ?);`,
      [
        idReporte,
        Number(idAuditoria),
        nombre || 'Reporte Final',
        observaciones || '',
        url,
        nombreArchivo,
        Number(creadoPor),
        creadoEn
      ]
    );

    let auditoriaActualizada = auditoria;
    if (Number(auditoria.id_estado) !== AUDITORIA_FINALIZADA) {
      await connection.execute(
        `UPDATE auditorias
         SET id_estado = ?,
             estado_actualizado_en = ?
         WHERE id_auditoria = ?;`,
        [AUDITORIA_FINALIZADA, creadoEn, Number(idAuditoria)]
      );

      auditoriaActualizada = {
        ...auditoria,
        id_estado: AUDITORIA_FINALIZADA,
        estado_actualizado_en: toIsoDateTime(creadoEn)
      };
    }

    await connection.commit();
    transactionStarted = false;

    return {
      reporte: normalizeReporte({
        id_reporte: idReporte,
        id_auditoria: Number(idAuditoria),
        nombre: nombre || 'Reporte Final',
        tipo: 'FINAL',
        observaciones: observaciones || '',
        url,
        nombre_archivo: nombreArchivo,
        creado_por: Number(creadoPor),
        fecha_creacion: creadoEn
      }),
      auditoria: auditoriaActualizada
    };
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    throw error;
  } finally {
    if (lockAcquired) {
      await releaseLock(connection, lockName);
    }
    connection.release();
  }
}

async function updateAuditoriaObjetivoMysql(idAuditoria, objetivo) {
  const pool = getPool();
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    const auditoria = await selectAuditoriaForUpdate(connection, idAuditoria);
    const objetivoFinal = objetivo === undefined ? null : objetivo;

    await connection.execute(
      `UPDATE auditorias
       SET objetivo = ?
       WHERE id_auditoria = ?;`,
      [objetivoFinal, Number(idAuditoria)]
    );

    await connection.commit();
    transactionStarted = false;

    return {
      ...auditoria,
      objetivo: objetivoFinal
    };
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function assignAuditorMysql({ idAuditoria, idAuditor, idEmpresaAuditora }) {
  const pool = getPool();
  const connection = await pool.getConnection();
  const lockName = 'auditcloud:auditoria_participantes:create';
  let transactionStarted = false;
  let lockAcquired = false;

  try {
    await acquireLock(connection, lockName);
    lockAcquired = true;
    await connection.beginTransaction();
    transactionStarted = true;

    const auditoria = await selectAuditoriaForUpdate(connection, idAuditoria);
    assertEmpresaAuditora(auditoria, idEmpresaAuditora);

    const [auditorRows] = await connection.execute(
      `SELECT id_usuario, id_empresa, id_rol, activo
       FROM usuarios
       WHERE id_usuario = ?
       LIMIT 1;`,
      [Number(idAuditor)]
    );
    const auditor = auditorRows[0];
    if (!auditor || Number(auditor.id_rol) !== 2 || Number(auditor.activo) !== 1) {
      throw buildError('AUDITORIA_AUDITOR_INVALIDO', 'Auditor no encontrado o inactivo.');
    }
    if (Number(auditor.id_empresa) !== Number(auditoria.id_empresa_auditora)) {
      throw buildError('AUDITORIA_AUDITOR_INVALIDO', 'El auditor no pertenece a la empresa auditora.');
    }

    const [duplicateRows] = await connection.execute(
      `SELECT id_participante, id_auditoria, id_auditor, asignado_en
       FROM auditoria_participantes
       WHERE id_auditoria = ? AND id_auditor = ?
       LIMIT 1;`,
      [Number(idAuditoria), Number(idAuditor)]
    );
    if (duplicateRows[0]) {
      throw buildError('AUDITORIA_PARTICIPANTE_DUPLICADO', 'Auditor ya asignado.');
    }

    const asignadoEn = toMysqlDateTime(new Date());
    const [idRows] = await connection.execute('SELECT COALESCE(MAX(id_participante), 0) + 1 AS nextId FROM auditoria_participantes;');
    const idParticipante = Number(idRows[0].nextId);

    await connection.execute(
      `INSERT INTO auditoria_participantes (
        id_participante,
        id_auditoria,
        id_auditor,
        asignado_en
      ) VALUES (?, ?, ?, ?);`,
      [idParticipante, Number(idAuditoria), Number(idAuditor), asignadoEn]
    );

    await connection.commit();
    transactionStarted = false;

    return {
      auditoria,
      asignacion: normalizeParticipante({
        id_participante: idParticipante,
        id_auditoria: Number(idAuditoria),
        id_auditor: Number(idAuditor),
        asignado_en: asignadoEn
      })
    };
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    throw error;
  } finally {
    if (lockAcquired) {
      await releaseLock(connection, lockName);
    }
    connection.release();
  }
}

async function addAuditoriaModuloMysql({ idAuditoria, idModulo, idEmpresaAuditora }) {
  const pool = getPool();
  const connection = await pool.getConnection();
  const lockName = 'auditcloud:auditoria_modulos:create';
  let transactionStarted = false;
  let lockAcquired = false;

  try {
    await acquireLock(connection, lockName);
    lockAcquired = true;
    await connection.beginTransaction();
    transactionStarted = true;

    const auditoria = await selectAuditoriaForUpdate(connection, idAuditoria);
    assertEmpresaAuditora(auditoria, idEmpresaAuditora);

    const [moduloRows] = await connection.execute(
      `SELECT id_modulo
       FROM modulos_ambientales
       WHERE id_modulo = ?
       LIMIT 1;`,
      [Number(idModulo)]
    );
    if (!moduloRows[0]) {
      throw buildError('AUDITORIA_MODULO_INVALIDO', 'Modulo ambiental no encontrado.');
    }

    const [duplicateRows] = await connection.execute(
      `SELECT id_auditoria_modulo, id_auditoria, id_modulo, registrado_en
       FROM auditoria_modulos
       WHERE id_auditoria = ? AND id_modulo = ?
       LIMIT 1;`,
      [Number(idAuditoria), Number(idModulo)]
    );
    if (duplicateRows[0]) {
      throw buildError('AUDITORIA_MODULO_DUPLICADO', 'Modulo ya agregado a la auditoria.');
    }

    const registradoEn = toMysqlDateTime(new Date());
    const [idRows] = await connection.execute('SELECT COALESCE(MAX(id_auditoria_modulo), 0) + 1 AS nextId FROM auditoria_modulos;');
    const idAuditoriaModulo = Number(idRows[0].nextId);

    await connection.execute(
      `INSERT INTO auditoria_modulos (
        id_auditoria_modulo,
        id_auditoria,
        id_modulo,
        registrado_en
      ) VALUES (?, ?, ?, ?);`,
      [idAuditoriaModulo, Number(idAuditoria), Number(idModulo), registradoEn]
    );

    await connection.commit();
    transactionStarted = false;

    return normalizeModulo({
      id_auditoria_modulo: idAuditoriaModulo,
      id_auditoria: Number(idAuditoria),
      id_modulo: Number(idModulo),
      registrado_en: registradoEn
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    throw error;
  } finally {
    if (lockAcquired) {
      await releaseLock(connection, lockName);
    }
    connection.release();
  }
}

async function syncReporteFinalJson({ reporte, auditoria }) {
  const reportes = await readJson('reportes.json');
  const reportIndex = reportes.findIndex((item) => Number(item.id_reporte) === Number(reporte.id_reporte));
  const reporteJson = normalizeReporte(reporte);

  if (reportIndex === -1) {
    reportes.push(reporteJson);
  } else {
    reportes[reportIndex] = {
      ...reportes[reportIndex],
      ...reporteJson
    };
  }
  await writeJson('reportes.json', reportes);

  const auditorias = await readJson('auditorias.json');
  const auditIndex = auditorias.findIndex((item) => Number(item.id_auditoria) === Number(auditoria.id_auditoria));
  const auditoriaJson = normalizeAuditoria(auditoria);

  if (auditIndex === -1) {
    auditorias.push(auditoriaJson);
  } else {
    auditorias[auditIndex] = {
      ...auditorias[auditIndex],
      id_estado: auditoriaJson.id_estado,
      estado_actualizado_en: auditoriaJson.estado_actualizado_en
    };
  }
  await writeJson('auditorias.json', auditorias);

  return {
    reporte: reportIndex === -1 ? reporteJson : reportes[reportIndex],
    auditoria: auditIndex === -1 ? auditoriaJson : auditorias[auditIndex]
  };
}

async function syncAuditoriaObjetivoJson(auditoria) {
  const auditorias = await readJson('auditorias.json');
  const index = auditorias.findIndex((item) => Number(item.id_auditoria) === Number(auditoria.id_auditoria));
  const auditoriaJson = normalizeAuditoria(auditoria);

  if (index === -1) {
    auditorias.push(auditoriaJson);
  } else {
    auditorias[index] = {
      ...auditorias[index],
      objetivo: auditoriaJson.objetivo
    };
  }

  await writeJson('auditorias.json', auditorias);
  return index === -1 ? auditoriaJson : auditorias[index];
}

async function syncAuditoriaParticipanteJson(asignacion) {
  const participantes = await readJson('auditoria_participantes.json');
  const index = participantes.findIndex((item) =>
    Number(item.id_auditoria) === Number(asignacion.id_auditoria) &&
    Number(item.id_auditor) === Number(asignacion.id_auditor)
  );
  const asignacionJson = normalizeParticipante(asignacion);

  if (index === -1) {
    participantes.push(asignacionJson);
  } else {
    participantes[index] = {
      ...participantes[index],
      ...asignacionJson
    };
  }

  await writeJson('auditoria_participantes.json', participantes);
  return index === -1 ? asignacionJson : participantes[index];
}

async function syncAuditoriaModuloJson(item) {
  const modulos = await readJson('auditoria_modulos.json');
  const index = modulos.findIndex((actual) =>
    Number(actual.id_auditoria) === Number(item.id_auditoria) &&
    Number(actual.id_modulo) === Number(item.id_modulo)
  );
  const itemJson = normalizeModulo(item);

  if (index === -1) {
    modulos.push(itemJson);
  } else {
    modulos[index] = {
      ...modulos[index],
      ...itemJson
    };
  }

  await writeJson('auditoria_modulos.json', modulos);
  return index === -1 ? itemJson : modulos[index];
}

module.exports = {
  createReporteFinalAndFinalizeMysql,
  updateAuditoriaObjetivoMysql,
  assignAuditorMysql,
  addAuditoriaModuloMysql,
  syncReporteFinalJson,
  syncAuditoriaObjetivoJson,
  syncAuditoriaParticipanteJson,
  syncAuditoriaModuloJson
};
