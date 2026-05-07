const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const PRESETS = require('../lib/class-presets');

const USER_PRESETS_PATH = path.join(__dirname, '../../data/user_presets.json');

function readUserPresets() {
  if (!fs.existsSync(USER_PRESETS_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(USER_PRESETS_PATH, 'utf8')); }
  catch { return {}; }
}

function writeUserPresets(obj) {
  fs.mkdirSync(path.dirname(USER_PRESETS_PATH), { recursive: true });
  fs.writeFileSync(USER_PRESETS_PATH, JSON.stringify(obj, null, 2));
}

function summary(id, p, isUser = false) {
  return {
    id,
    name: p.name,
    description: p.description || '',
    source: p.source || (isUser ? 'User' : ''),
    url: p.url || null,
    classCount: (p.classes || []).length,
    user: isUser,
  };
}

// GET /api/presets — built-in + user presets (summaries)
router.get('/', (req, res) => {
  const built = Object.entries(PRESETS).map(([id, p]) => summary(id, p, false));
  const user  = Object.entries(readUserPresets()).map(([id, p]) => summary(id, p, true));
  res.json([...built, ...user]);
});

// GET /api/presets/:id — full preset (built-in or user)
router.get('/:id', (req, res) => {
  const id = req.params.id;
  const preset = PRESETS[id] || readUserPresets()[id];
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  res.json({ id, ...preset });
});

// POST /api/presets — save current schema as a reusable user preset
router.post('/', (req, res) => {
  const name = (req.body.name || '').trim();
  const classes = req.body.classes;
  if (!name) return res.status(400).json({ error: 'Preset name required' });
  if (!Array.isArray(classes) || !classes.length) {
    return res.status(400).json({ error: 'Classes array required' });
  }
  // Block overwriting a built-in preset id.
  const id = `user_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}_${Date.now().toString(36)}`;
  const presets = readUserPresets();
  presets[id] = {
    name,
    description: req.body.description || 'User-saved preset',
    source: 'User',
    classes,
  };
  writeUserPresets(presets);
  res.json({ id });
});

// DELETE /api/presets/:id — delete a user preset (built-ins are immutable)
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  if (PRESETS[id]) return res.status(400).json({ error: 'Cannot delete a built-in preset' });
  const presets = readUserPresets();
  if (!presets[id]) return res.status(404).json({ error: 'Preset not found' });
  delete presets[id];
  writeUserPresets(presets);
  res.json({ success: true });
});

module.exports = router;
