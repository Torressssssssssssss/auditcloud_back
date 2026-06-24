const express = require('express');
const router = express.Router();

const { pingElasticsearch } = require('../services/elasticsearchAuditorias.service');

router.get('/health', async (req, res) => {
  const health = await pingElasticsearch();
  res.status(health.connected || !health.enabled ? 200 : 503).json(health);
});

module.exports = router;
