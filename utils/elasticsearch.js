const { Client } = require('@elastic/elasticsearch');

let client = null;

function isElasticsearchEnabled() {
  return String(process.env.ELASTICSEARCH_ENABLED || 'false').toLowerCase() === 'true';
}

function getElasticsearchNode() {
  return String(process.env.ELASTICSEARCH_NODE || 'http://192.168.30.11:9200').trim();
}

function getAuditoriasIndex() {
  return String(process.env.ELASTICSEARCH_INDEX_AUDITORIAS || 'auditcloud_auditorias').trim();
}

function getElasticsearchClient() {
  if (!isElasticsearchEnabled()) {
    return null;
  }

  if (client) {
    return client;
  }

  const options = {
    node: getElasticsearchNode()
  };

  const username = String(process.env.ELASTICSEARCH_USERNAME || '').trim();
  const password = String(process.env.ELASTICSEARCH_PASSWORD || '').trim();
  if (username && password) {
    options.auth = { username, password };
  }

  client = new Client(options);
  return client;
}

async function safeElasticOperation(operationName, operation) {
  if (!isElasticsearchEnabled()) {
    return { enabled: false, ok: false, skipped: true };
  }

  try {
    const result = await operation(getElasticsearchClient());
    return { enabled: true, ok: true, result };
  } catch (error) {
    console.warn(`[Elasticsearch] ${operationName} fallo:`, {
      message: error?.message,
      statusCode: error?.meta?.statusCode
    });
    return { enabled: true, ok: false, error };
  }
}

module.exports = {
  getElasticsearchClient,
  getElasticsearchNode,
  getAuditoriasIndex,
  isElasticsearchEnabled,
  safeElasticOperation
};
