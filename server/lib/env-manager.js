const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../../.env');

// Parse both proper `KEY=VALUE` lines AND legacy "# Planet\nPLAK..." style.
// Returns { env, legacy: true } when legacy entries were found so the caller
// can decide to re-format the file.
function _parse(content) {
  const env = {};
  let legacy = false;
  let lastComment = '';

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    if (!line) { lastComment = ''; continue; }
    if (line.startsWith('#')) { lastComment = line.slice(1).trim().toLowerCase(); continue; }

    const eq = line.indexOf('=');
    if (eq !== -1) {
      env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      lastComment = '';
      continue;
    }

    // Legacy: bare value. Identify by preceding comment first, then by prefix.
    let mappedKey = null;
    if (lastComment.includes('planet'))                       mappedKey = 'PLANET_API_KEY';
    else if (lastComment.includes('esri') || lastComment.includes('arcgis')) mappedKey = 'ESRI_API_KEY';
    else if (line.startsWith('PLAK'))                         mappedKey = 'PLANET_API_KEY';
    else if (line.startsWith('AAPT'))                         mappedKey = 'ESRI_API_KEY';

    if (mappedKey) { env[mappedKey] = line; legacy = true; }
    lastComment = '';
  }

  return { env, legacy };
}

function _format(env) {
  const lines = [
    '# EarthLabel API keys — managed by the Settings UI',
    '# Edit manually only if you know what you are doing',
    '',
  ];
  if (env.PLANET_API_KEY) {
    lines.push('# Planet API key  — https://www.planet.com/account/');
    lines.push(`PLANET_API_KEY=${env.PLANET_API_KEY}`);
    lines.push('');
  }
  if (env.ESRI_API_KEY) {
    lines.push('# ESRI / ArcGIS API key — https://developers.arcgis.com/');
    lines.push(`ESRI_API_KEY=${env.ESRI_API_KEY}`);
    lines.push('');
  }
  if (env.SENTINEL_HUB_CLIENT_ID || env.SENTINEL_HUB_CLIENT_SECRET) {
    lines.push('# Sentinel Hub OAuth — https://www.sentinel-hub.com/');
    if (env.SENTINEL_HUB_CLIENT_ID)     lines.push(`SENTINEL_HUB_CLIENT_ID=${env.SENTINEL_HUB_CLIENT_ID}`);
    if (env.SENTINEL_HUB_CLIENT_SECRET) lines.push(`SENTINEL_HUB_CLIENT_SECRET=${env.SENTINEL_HUB_CLIENT_SECRET}`);
    lines.push('');
  }
  const KNOWN = new Set(['PLANET_API_KEY', 'ESRI_API_KEY',
                          'SENTINEL_HUB_CLIENT_ID', 'SENTINEL_HUB_CLIENT_SECRET']);
  for (const [k, v] of Object.entries(env)) {
    if (KNOWN.has(k)) continue;
    lines.push(`${k}=${v}`);
  }
  return lines.join('\n');
}

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const { env, legacy } = _parse(fs.readFileSync(ENV_PATH, 'utf8'));
  // One-shot auto-migration: rewrite legacy file in clean format
  if (legacy && Object.keys(env).length) {
    try { fs.writeFileSync(ENV_PATH, _format(env)); } catch (_) {}
  }
  return env;
}

function writeEnv(updates) {
  const current = fs.existsSync(ENV_PATH)
    ? _parse(fs.readFileSync(ENV_PATH, 'utf8')).env
    : {};
  const merged = { ...current, ...updates };
  for (const k of Object.keys(merged)) {
    if (merged[k] === '' || merged[k] == null) delete merged[k];
  }
  fs.writeFileSync(ENV_PATH, _format(merged));
}

module.exports = { readEnv, writeEnv };
