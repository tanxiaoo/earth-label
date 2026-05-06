const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../../.env');

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const result = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    result[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return result;
}

function writeEnv(updates) {
  const merged = { ...readEnv(), ...updates };
  for (const k of Object.keys(merged)) {
    if (merged[k] === '' || merged[k] == null) delete merged[k];
  }
  fs.writeFileSync(ENV_PATH, Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}

module.exports = { readEnv, writeEnv };
