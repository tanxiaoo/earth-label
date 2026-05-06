const router = require('express').Router();
const { readEnv, writeEnv } = require('../lib/env-manager');

// GET /api/keys/status — tells frontend which keys are configured (never returns values)
router.get('/status', (req, res) => {
  const env = readEnv();
  res.json({
    planet: !!(env.PLANET_API_KEY && env.PLANET_API_KEY.trim()),
    esri:   !!(env.ESRI_API_KEY   && env.ESRI_API_KEY.trim()),
  });
});

// POST /api/keys — save one or both keys to .env
router.post('/', (req, res) => {
  const { planet, esri } = req.body;
  const updates = {};
  if (typeof planet === 'string') updates.PLANET_API_KEY = planet.trim();
  if (typeof esri   === 'string') updates.ESRI_API_KEY   = esri.trim();
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to save' });
  writeEnv(updates);
  res.json({ success: true });
});

// DELETE /api/keys — clear one or both keys
router.delete('/', (req, res) => {
  const { planet, esri } = req.body;
  const updates = {};
  if (planet) updates.PLANET_API_KEY = '';
  if (esri)   updates.ESRI_API_KEY   = '';
  writeEnv(updates);
  res.json({ success: true });
});

module.exports = router;
