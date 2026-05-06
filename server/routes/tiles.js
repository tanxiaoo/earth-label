// Server-side tile proxy — API keys never reach the browser
const router = require('express').Router();
const https = require('https');
const { readEnv } = require('../lib/env-manager');

function proxyTile(url, res) {
  https.get(url, (upstream) => {
    res.set('Content-Type', upstream.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    upstream.pipe(res);
  }).on('error', () => res.status(502).end());
}

// GET /api/tiles/planet/:period/:z/:x/:y
// period = e.g. "global_monthly_2024_06_mosaic"
router.get('/planet/:period/:z/:x/:y', (req, res) => {
  const key = readEnv().PLANET_API_KEY;
  if (!key) return res.status(401).json({ error: 'Planet API key not set. Add it in Settings.' });
  const { period, z, x, y } = req.params;
  proxyTile(
    `https://tiles.planet.com/basemaps/v1/planet-tiles/${period}/gmap/${z}/${x}/${y}.png?api_key=${key}`,
    res
  );
});

// GET /api/tiles/esri-wayback/:release/:z/:y/:x
router.get('/esri-wayback/:release/:z/:y/:x', (req, res) => {
  const key = readEnv().ESRI_API_KEY;
  const { release, z, y, x } = req.params;
  const token = key ? `?token=${key}` : '';
  proxyTile(
    `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${release}/${z}/${y}/${x}${token}`,
    res
  );
});

// GET /api/tiles/esri-world/:z/:y/:x
router.get('/esri-world/:z/:y/:x', (req, res) => {
  const key = readEnv().ESRI_API_KEY;
  const { z, y, x } = req.params;
  const token = key ? `?token=${key}` : '';
  proxyTile(
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}${token}`,
    res
  );
});

module.exports = router;
