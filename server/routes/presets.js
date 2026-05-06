const router = require('express').Router();
const PRESETS = require('../lib/class-presets');

// GET /api/presets — list of presets (summary only)
router.get('/', (req, res) => {
  const list = Object.entries(PRESETS).map(([id, p]) => ({
    id,
    name: p.name,
    description: p.description,
    source: p.source,
    url: p.url || null,
    classCount: p.classes.length,
  }));
  res.json(list);
});

// GET /api/presets/:id — full preset with classes
router.get('/:id', (req, res) => {
  const preset = PRESETS[req.params.id];
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  res.json({ id: req.params.id, ...preset });
});

module.exports = router;
