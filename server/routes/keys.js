const router = require('express').Router();
const { readEnv, writeEnv } = require('../lib/env-manager');

// GET /api/keys/status — tells frontend which keys are configured (never returns values)
router.get('/status', (req, res) => {
  const env = readEnv();
  res.json({
    planet:           !!(env.PLANET_API_KEY            && env.PLANET_API_KEY.trim()),
    esri:             !!(env.ESRI_API_KEY              && env.ESRI_API_KEY.trim()),
    sentinel_hub_id:  !!(env.SENTINEL_HUB_CLIENT_ID    && env.SENTINEL_HUB_CLIENT_ID.trim()),
    sentinel_hub_sec: !!(env.SENTINEL_HUB_CLIENT_SECRET && env.SENTINEL_HUB_CLIENT_SECRET.trim()),
  });
});

// POST /api/keys — save one or more keys to .env
router.post('/', (req, res) => {
  const { planet, esri, sentinel_hub_id, sentinel_hub_secret } = req.body;
  const updates = {};
  if (typeof planet              === 'string') updates.PLANET_API_KEY             = planet.trim();
  if (typeof esri                === 'string') updates.ESRI_API_KEY               = esri.trim();
  if (typeof sentinel_hub_id     === 'string') updates.SENTINEL_HUB_CLIENT_ID     = sentinel_hub_id.trim();
  if (typeof sentinel_hub_secret === 'string') updates.SENTINEL_HUB_CLIENT_SECRET = sentinel_hub_secret.trim();
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to save' });
  writeEnv(updates);
  res.json({ success: true });
});

// DELETE /api/keys — clear one or more keys
router.delete('/', (req, res) => {
  const { planet, esri, sentinel_hub_id, sentinel_hub_secret } = req.body;
  const updates = {};
  if (planet)              updates.PLANET_API_KEY             = '';
  if (esri)                updates.ESRI_API_KEY               = '';
  if (sentinel_hub_id)     updates.SENTINEL_HUB_CLIENT_ID     = '';
  if (sentinel_hub_secret) updates.SENTINEL_HUB_CLIENT_SECRET = '';
  writeEnv(updates);
  res.json({ success: true });
});

module.exports = router;
