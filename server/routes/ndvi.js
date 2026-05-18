// Sentinel Hub Statistical API proxy — returns monthly NDVI for a point.
// Credentials are read from .env via env-manager; they never reach the browser.
const router = require('express').Router();
const https = require('https');
const { readEnv } = require('../lib/env-manager');

// Copernicus Data Space Ecosystem (CDSE) endpoints — free tier with a CDSE
// account. The commercial sentinel-hub.com endpoints use a different identity
// realm and would reject CDSE-issued client credentials.
const OAUTH_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const STATS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/statistics';

// Module-level token cache — Sentinel Hub tokens last ~1h.
let tokenCache = { token: null, expiresAt: 0 };

function httpRequest(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: buf });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 60_000) return tokenCache.token;

  const { SENTINEL_HUB_CLIENT_ID, SENTINEL_HUB_CLIENT_SECRET } = readEnv();
  if (!SENTINEL_HUB_CLIENT_ID || !SENTINEL_HUB_CLIENT_SECRET) {
    const err = new Error('Sentinel Hub credentials not configured. Add them in Settings.');
    err.code = 'NO_CREDS';
    err.status = 401;
    throw err;
  }

  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: SENTINEL_HUB_CLIENT_ID,
    client_secret: SENTINEL_HUB_CLIENT_SECRET,
  }).toString();

  const r = await httpRequest(OAUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(form),
    },
    body: form,
  });

  if (r.status !== 200) {
    const err = new Error('Sentinel Hub authentication failed — check Client ID / Secret in Settings.');
    err.code = 'INVALID_CREDS';
    err.status = 401;
    throw err;
  }

  const data = JSON.parse(r.body);
  tokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

// Build a small ~60m bbox around the point so the Statistical API has a
// sample of S2 pixels (10m native) to aggregate.
function pointToBbox(lat, lon) {
  const dLat = 0.00027;                                  // ~30 m
  const dLon = 0.00027 / Math.cos(lat * Math.PI / 180);  // ~30 m at this latitude
  // CDSE expects [minLon, minLat, maxLon, maxLat]
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

const EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
    output: [
      { id: "data", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(s) {
  let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04);
  let valid = 1;
  if (s.B08 + s.B04 == 0) valid = 0;
  // SCL=6 is water; SCL=3 shadow, 8/9/10 cloud/cirrus — mask all of these.
  let noBad = 1;
  if (s.SCL == 3 || s.SCL == 6 || s.SCL == 8 || s.SCL == 9 || s.SCL == 10) noBad = 0;
  return { data: [ndvi], dataMask: [s.dataMask * valid * noBad] };
}`;

function buildStatsRequest(lat, lon, year) {
  return {
    input: {
      bounds: {
        bbox: pointToBbox(lat, lon),
        properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
      },
      data: [{
        type: 'sentinel-2-l2a',
        dataFilter: { maxCloudCoverage: 30 },
      }],
    },
    aggregation: {
      timeRange: {
        // `to` must be the start of January next year so the December P1M
        // bucket spans Dec 1 → Jan 1 (Sentinel Hub returns no December
        // interval when `to` is mid-month).
        from: `${year}-01-01T00:00:00Z`,
        to:   `${year + 1}-01-01T00:00:00Z`,
      },
      aggregationInterval: { of: 'P1M' },
      evalscript: EVALSCRIPT,
    },
  };
}

function parseStatsResponse(body, year) {
  // Initialise 12 months as null in case Sentinel Hub skips empty intervals.
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, mean: null, count: 0,
  }));
  const data = body?.data || [];
  for (const interval of data) {
    const from = interval.interval?.from;
    if (!from) continue;
    const m = new Date(from).getUTCMonth();          // 0..11
    // Evalscript output id is "data" → bands.B0.stats
    const stats = interval.outputs?.data?.bands?.B0?.stats;
    if (!stats || stats.sampleCount === 0 || stats.sampleCount === stats.noDataCount) continue;
    months[m] = {
      month: m + 1,
      mean: typeof stats.mean === 'number' ? Number(stats.mean.toFixed(4)) : null,
      count: (stats.sampleCount || 0) - (stats.noDataCount || 0),
    };
  }
  return months;
}

// POST /api/ndvi/monthly  body: { lat, lon, year? }
router.post('/monthly', async (req, res) => {
  const lat = Number(req.body?.lat);
  const lon = Number(req.body?.lon);
  const year = Number.isInteger(req.body?.year) ? req.body.year : 2025;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon are required numbers', code: 'BAD_REQUEST' });
  }

  let token;
  try { token = await getToken(); }
  catch (err) {
    return res.status(err.status || 500).json({ error: err.message, code: err.code || 'AUTH_ERROR' });
  }

  const payload = JSON.stringify(buildStatsRequest(lat, lon, year));
  const r = await httpRequest(STATS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
    body: payload,
  });

  if (r.status === 401 || r.status === 403) {
    // Force token refresh next call.
    tokenCache = { token: null, expiresAt: 0 };
    return res.status(401).json({ error: 'Sentinel Hub rejected the request — check credentials.', code: 'INVALID_CREDS' });
  }
  if (r.status === 429) {
    return res.status(429).json({ error: 'Sentinel Hub quota / rate limit exceeded.', code: 'QUOTA_EXCEEDED' });
  }
  if (r.status >= 400) {
    let detail = '';
    try { detail = JSON.parse(r.body)?.error?.message || ''; } catch (_) {}
    return res.status(502).json({
      error: `Sentinel Hub request failed (HTTP ${r.status}). ${detail}`.trim(),
      code: 'UPSTREAM_ERROR',
    });
  }

  let body;
  try { body = JSON.parse(r.body); }
  catch (_) { return res.status(502).json({ error: 'Invalid response from Sentinel Hub.', code: 'PARSE_ERROR' }); }

  const months = parseStatsResponse(body, year);
  const valid = months.filter(m => m.mean != null).length;
  if (valid === 0) {
    return res.json({ year, months, warning: 'No valid Sentinel-2 observations for this point in the selected year (no coverage or persistent cloud).' });
  }
  res.json({ year, months });
});

module.exports = router;
