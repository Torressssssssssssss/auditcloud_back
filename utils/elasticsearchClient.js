// Cliente centralizado de Elasticsearch. No debe romper el backend si ES esta caido.
const { Client } = require('@elastic/elasticsearch');

let client = null;
const REQUEST_TIMEOUT_MS = 3000;

function isElasticsearchEnabled() {
  return String(process.env.ELASTICSEARCH_ENABLED || 'false').toLowerCase() === 'true';
}

function getElasticsearchConfig() {
  const enabled = isElasticsearchEnabled();
  const node = process.env.ELASTICSEARCH_NODE || 'http://192.168.30.11:9200';
  const indexAuditorias = process.env.ELASTICSEARCH_INDEX_AUDITORIAS || 'auditcloud_auditorias';
  const username = String(process.env.ELASTICSEARCH_USERNAME || '').trim();
  const password = String(process.env.ELASTICSEARCH_PASSWORD || '').trim();

  return {
    enabled,
    node,
    indexAuditorias,
    username,
    password
  };
}

function getElasticsearchClient() {
  const config = getElasticsearchConfig();
  if (!config.enabled) return null;

  if (!client) {
    const clientOptions = {
      node: config.node,
      requestTimeout: REQUEST_TIMEOUT_MS,
      maxRetries: 0
    };

    if (config.username && config.password) {
      clientOptions.auth = {
        username: config.username,
        password: config.password
      };
    }

    client = new Client(clientOptions);
  }

  return client;
}

function resetElasticsearchClient() {
  if (!client) return;

  const currentClient = client;
  client = null;

  currentClient.close().catch((error) => {
    console.error('[Elasticsearch] Error cerrando cliente:', {
      name: error?.name,
      message: error?.message
    });
  });
}

function createTimeoutPromise(controller) {
  let timeoutId;

  const promise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      const error = new Error(`Timeout de Elasticsearch despues de ${REQUEST_TIMEOUT_MS}ms`);
      error.name = 'TimeoutError';
      reject(error);
    }, REQUEST_TIMEOUT_MS);

    timeoutId.unref?.();
  });

  return {
    promise,
    clear: () => clearTimeout(timeoutId)
  };
}

async function pingElasticsearch() {
  const config = getElasticsearchConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      node: config.node,
      connected: false
    };
  }

  let timeout;

  try {
    const esClient = getElasticsearchClient();
    const controller = new AbortController();
    timeout = createTimeoutPromise(controller);

    await Promise.race([
      esClient.ping({}, {
        requestTimeout: REQUEST_TIMEOUT_MS,
        maxRetries: 0,
        signal: controller.signal
      }),
      timeout.promise
    ]);

    return {
      enabled: true,
      node: config.node,
      connected: true
    };
  } catch (error) {
    resetElasticsearchClient();

    console.error('[Elasticsearch] Error de conexion:', {
      node: config.node,
      name: error?.name,
      message: error?.message
    });

    return {
      enabled: true,
      node: config.node,
      connected: false
    };
  } finally {
    timeout?.clear();
  }
}

module.exports = {
  getElasticsearchConfig,
  getElasticsearchClient,
  resetElasticsearchClient,
  pingElasticsearch
};
