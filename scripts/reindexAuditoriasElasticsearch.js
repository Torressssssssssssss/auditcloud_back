// Script CLI interno para reindexar auditorias historicas desde MySQL hacia Elasticsearch.
require('dotenv').config();

const { reindexAuditorias } = require('../utils/elasticsearchAuditorias.service');
const { closePool } = require('../utils/db');
const { resetElasticsearchClient } = require('../utils/elasticsearchClient');

function parseBatchSize(argv) {
  const arg = argv.find((item) => item.startsWith('--batch-size='));
  if (!arg) return undefined;

  const value = Number(arg.split('=')[1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

async function closeResources() {
  try {
    await closePool();
  } catch (error) {
    if (error?.code !== 'DB_NOT_CONFIGURED') {
      console.error('[Reindex] Error cerrando pool MySQL:', error?.message || error);
    }
  }

  resetElasticsearchClient();
}

async function main() {
  const batchSize = parseBatchSize(process.argv.slice(2));
  const result = await reindexAuditorias({ batchSize });

  console.log(JSON.stringify(result, null, 2));

  if (result.failed || result.total_fallidas > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('[Reindex] Error fatal:', error);
    process.exitCode = 1;
  })
  .finally(closeResources);
