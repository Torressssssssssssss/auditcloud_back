// Rutas de salud para Elasticsearch. No sincroniza datos.
const express = require('express');
const router = express.Router();

const { getElasticsearchConfig, pingElasticsearch } = require('../utils/elasticsearchClient');

// GET /api/elastic/health
router.get('/health', async (req, res) => {
  const config = getElasticsearchConfig();

  if (!config.enabled) {
    return res.json({
      enabled: false,
      node: config.node,
      connected: false
    });
  }

  const health = await pingElasticsearch();
  res.json(health);
});

module.exports = router;
