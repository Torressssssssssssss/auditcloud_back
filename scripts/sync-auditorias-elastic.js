require('dotenv').config();

const { query, getPool } = require('../utils/db');
const { indexAuditoria, pingElasticsearch } = require('../services/elasticsearchAuditorias.service');

async function cargarAuditoriasMysql() {
  return query(
    `SELECT
      a.id_auditoria,
      a.id_empresa_auditora,
      a.id_cliente,
      cliente.id_empresa AS id_empresa_cliente,
      a.id_solicitud_pago,
      a.id_estado,
      a.monto,
      a.fecha_inicio,
      a.creada_en,
      a.objetivo,
      a.estado_actualizado_en
    FROM auditorias a
    LEFT JOIN usuarios cliente ON cliente.id_usuario = a.id_cliente
    ORDER BY a.id_auditoria;`
  );
}

async function main() {
  const health = await pingElasticsearch();
  console.log(`Elasticsearch enabled=${health.enabled} connected=${health.connected} index=${health.index}`);

  if (!health.enabled) {
    console.log('Sincronizacion omitida: ELASTICSEARCH_ENABLED=false');
    return;
  }

  if (!health.connected) {
    console.log('Sincronizacion omitida: Elasticsearch no esta conectado. MySQL no se modifica.');
    return;
  }

  const auditorias = await cargarAuditoriasMysql();
  let ok = 0;
  let failed = 0;

  for (const auditoria of auditorias) {
    const result = await indexAuditoria(auditoria);
    if (result.ok) {
      ok += 1;
    } else {
      failed += 1;
    }
  }

  console.log(`Auditorias leidas desde MySQL: ${auditorias.length}`);
  console.log(`Auditorias indexadas/upsert: ${ok}`);
  console.log(`Auditorias con error Elastic: ${failed}`);
}

main()
  .catch((error) => {
    console.error('Error sincronizando auditorias a Elasticsearch:', {
      message: error?.message,
      code: error?.code
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await getPool().end();
    } catch {
      // No hay pool abierto o MySQL no estaba configurado.
    }
  });
