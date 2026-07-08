// Tree canopy height for a point, from the ECHOSAT dataset via Google Earth
// Engine. A small Python helper (lib/canopy_ee.py) does the EE sampling using
// the machine's `earthengine authenticate` credentials; the Cloud project is
// read from GEE_PROJECT in .env so the repo stays portable. Credentials never
// reach the browser.
const router = require('express').Router();
const path = require('path');
const { spawn } = require('child_process');
const { readEnv } = require('../lib/env-manager');

const HELPER = path.join(__dirname, '../lib/canopy_ee.py');
// Windows uses `python`; allow override for environments where it's python3.
const PYTHON = process.env.PYTHON_BIN || 'python';
const FIRST_YEAR = 2018;
const LAST_YEAR = 2024;
const TIMEOUT_MS = 30_000;

// Run the helper and resolve with its parsed JSON line, or reject with an
// Error carrying { status, code } shaped like ndvi.js failures.
function runHelper(lat, lon, year, geeProject) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [HELPER, String(lat), String(lon), String(year)], {
      env: { ...process.env, GEE_PROJECT: geeProject },
    });

    let stdout = '';
    let stderr = '';
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill();
      const err = new Error('Canopy height query timed out.');
      err.status = 504; err.code = 'TIMEOUT';
      reject(err);
    }, TIMEOUT_MS);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // Typically ENOENT — Python not found on PATH.
      const err = new Error(`Could not run Python helper (${e.message}). Is Python installed?`);
      err.status = 500; err.code = 'NO_PYTHON';
      reject(err);
    });

    child.on('close', (exitCode) => {
      if (done) return;
      done = true;
      clearTimeout(timer);

      // The helper prints one JSON line on both success and handled failure.
      let parsed = null;
      const line = stdout.trim().split('\n').filter(Boolean).pop();
      if (line) { try { parsed = JSON.parse(line); } catch (_) {} }

      if (parsed && parsed.error) {
        const status = parsed.code === 'EE_AUTH' || parsed.code === 'NO_GEE_PROJECT' ? 401 : 502;
        const err = new Error(parsed.error);
        err.status = status; err.code = parsed.code || 'HELPER_ERROR';
        return reject(err);
      }
      if (exitCode !== 0 || !parsed) {
        const err = new Error(
          `Canopy helper failed${stderr ? `: ${stderr.trim().split('\n').pop()}` : '.'}`
        );
        err.status = 502; err.code = 'HELPER_ERROR';
        return reject(err);
      }
      resolve(parsed);
    });
  });
}

// POST /api/canopy/point  body: { lat, lon, year? }
router.post('/point', async (req, res) => {
  const lat = Number(req.body?.lat);
  const lon = Number(req.body?.lon);
  const reqYear = Number.isInteger(req.body?.year) ? req.body.year : LAST_YEAR;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon are required numbers', code: 'BAD_REQUEST' });
  }

  const { GEE_PROJECT } = readEnv();
  if (!GEE_PROJECT) {
    return res.status(401).json({
      error: 'Google Earth Engine project not configured. Set GEE_PROJECT in .env and run `earthengine authenticate`.',
      code: 'NO_GEE_PROJECT',
    });
  }

  try {
    // Pass the requested year through; the helper clamps to 2018–2024 and
    // reports the actual year used plus a warning when it had to clamp.
    const result = await runHelper(lat, lon, reqYear, GEE_PROJECT);
    res.json({
      year: result.year ?? Math.max(FIRST_YEAR, Math.min(LAST_YEAR, reqYear)),
      heightM: result.heightM ?? null,
      unit: 'm',
      source: 'ECHOSAT',
      ...(result.warning ? { warning: result.warning } : {}),
      ...(result.heightM == null ? { warning: result.warning || 'No ECHOSAT canopy height at this location (water or no data).' } : {}),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code || 'ERROR' });
  }
});

module.exports = router;
