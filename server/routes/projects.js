const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { parseGIS } = require('../lib/gis-parser');

const DATA_DIR = path.join(__dirname, '../../data/projects');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

function projPath(id) { return path.join(DATA_DIR, `${id}.json`); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readProj(id) { return JSON.parse(fs.readFileSync(projPath(id), 'utf8')); }
function writeProj(proj) { fs.writeFileSync(projPath(proj.id), JSON.stringify(proj, null, 2)); }

// GET /api/projects — project list (summaries)
router.get('/', (req, res) => {
  ensureDir();
  const summaries = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
        return {
          id: p.id, name: p.name, created: p.created, lastUsed: p.lastUsed,
          plotCount: (p.plots || []).length,
          completedCount: Object.keys(p.results || {}).length,
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));
  res.json(summaries);
});

// GET /api/projects/:id — full project
router.get('/:id', (req, res) => {
  if (!fs.existsSync(projPath(req.params.id))) return res.status(404).json({ error: 'Not found' });
  res.json(readProj(req.params.id));
});

// POST /api/projects/json — create from raw JSON body (no file; used for demo/programmatic creation)
router.post('/json', (req, res) => {
  ensureDir();
  const { name, classSchema, plots } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name required' });
  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const proj = {
    id, name,
    created: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    classSchema: classSchema || [],
    plots: (plots || []).map(p => ({ ...p, geometry: p.geometry ?? null, meta: p.meta ?? {} })),
    results: {},
  };
  writeProj(proj);
  res.json({ id });
});

// POST /api/projects/parse-file — parse a GIS file and return plots preview
router.post('/parse-file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const plots = await parseGIS(req.file.buffer, req.file.originalname);
    res.json({ plots, count: plots.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/projects — create new project (with file upload)
router.post('/', upload.single('file'), async (req, res) => {
  ensureDir();
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Project name required' });

  let classSchema;
  try {
    classSchema = JSON.parse(req.body.classSchema || '[]');
  } catch {
    return res.status(400).json({ error: 'Invalid classSchema JSON' });
  }

  let plots = [];
  if (req.file) {
    try {
      plots = await parseGIS(req.file.buffer, req.file.originalname);
    } catch (err) {
      return res.status(400).json({ error: `File parse error: ${err.message}` });
    }
  }

  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const proj = {
    id, name,
    created: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    classSchema,
    plots,
    results: {},
  };
  writeProj(proj);
  res.json({ id });
});

// PATCH /api/projects/:id — incremental update (result, classSchema, name, lastUsed)
router.patch('/:id', (req, res) => {
  if (!fs.existsSync(projPath(req.params.id))) return res.status(404).json({ error: 'Not found' });
  const proj = readProj(req.params.id);
  const { plotId, result, classSchema, name, lastUsed } = req.body;

  if (plotId && result) {
    proj.results = proj.results || {};
    proj.results[plotId] = { ...result, savedAt: new Date().toISOString() };
  }
  if (classSchema) proj.classSchema = classSchema;
  if (name)        proj.name = name;
  proj.lastUsed = lastUsed || new Date().toISOString();

  writeProj(proj);
  res.json({ success: true });
});

// DELETE /api/projects/:id
router.delete('/:id', (req, res) => {
  const p = projPath(req.params.id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ success: true });
});

// GET /api/projects/:id/export — download project JSON
router.get('/:id/export', (req, res) => {
  if (!fs.existsSync(projPath(req.params.id))) return res.status(404).json({ error: 'Not found' });
  const proj = readProj(req.params.id);
  const safeName = proj.name.replace(/[^a-z0-9_\-]/gi, '_').toLowerCase();
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}_earthlabel.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(proj, null, 2));
});

// POST /api/projects/import — import a project JSON file
router.post('/import', upload.single('file'), (req, res) => {
  ensureDir();
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  let proj;
  try {
    proj = JSON.parse(req.file.buffer.toString('utf8'));
    if (!proj.id || !proj.name || !Array.isArray(proj.plots)) throw new Error('Invalid project file');
  } catch (err) {
    return res.status(400).json({ error: `Invalid project file: ${err.message}` });
  }
  // Avoid id collision
  if (fs.existsSync(projPath(proj.id))) {
    proj.id = `${proj.id}_imported_${Date.now()}`;
  }
  proj.lastUsed = new Date().toISOString();
  writeProj(proj);
  res.json({ id: proj.id });
});

module.exports = router;
