const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { parseGIS } = require('../lib/gis-parser');

const DATA_DIR = path.join(__dirname, '../../data/projects');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// Some multer/busboy versions decode multipart text fields as latin1 even
// though browsers send UTF-8 — that turns "Africa—test" (em-dash bytes
// e2 80 94) into mojibake like "AfricaâÂ€"test".
//
// Heuristic: detect a UTF-8 lead byte (Â-ô in latin1 view) followed by
// 1-3 continuation bytes (-¿). If found, re-decode from latin1 to
// utf8. Otherwise leave the string alone — modern multer hands us proper
// UTF-8 already.
function utf8(s) {
  if (typeof s !== 'string' || !s) return s;
  if (/[Â-ß][-¿]/.test(s) ||
      /[à-ï][-¿]{2}/.test(s) ||
      /[ð-ô][-¿]{3}/.test(s)) {
    return Buffer.from(s, 'latin1').toString('utf8');
  }
  return s;
}

function projPath(id) { return path.join(DATA_DIR, `${id}.json`); }
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readProj(id) { return JSON.parse(fs.readFileSync(projPath(id), 'utf8')); }
function writeProj(proj) { fs.writeFileSync(projPath(proj.id), JSON.stringify(proj, null, 2)); }

// Reserved column names that an annotation-field key must not collide with —
// these are the fixed columns the CSV/GeoJSON exporters always emit.
const RESERVED_ANNO_KEYS = new Set([
  'plotid','lat','lon','ref_code','ref_label',
  'class_code','class_label','confidence',
]);
const ANNO_KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;
const ANNO_TYPES = new Set(['text','binary']);
const DEFAULT_ANNOTATION_FIELDS = [{ key: 'notes', label: 'Notes', type: 'text' }];

// Validate annotationFields. Returns the cleaned array on success, throws on failure.
function validateAnnotationFields(fields) {
  if (!Array.isArray(fields)) throw new Error('annotationFields must be an array');
  const seen = new Set();
  return fields.map((f, i) => {
    if (!f || typeof f !== 'object') throw new Error(`annotationFields[${i}] must be an object`);
    const key = String(f.key || '').trim();
    const label = String(f.label || '').trim();
    const type = String(f.type || '').trim();
    if (!ANNO_KEY_RE.test(key)) throw new Error(`annotationFields[${i}].key invalid: "${key}" (must match ${ANNO_KEY_RE})`);
    if (RESERVED_ANNO_KEYS.has(key)) throw new Error(`annotationFields[${i}].key "${key}" conflicts with a built-in column`);
    if (seen.has(key)) throw new Error(`annotationFields[${i}].key "${key}" is duplicated`);
    if (!label) throw new Error(`annotationFields[${i}].label is required`);
    if (!ANNO_TYPES.has(type)) throw new Error(`annotationFields[${i}].type must be one of: ${[...ANNO_TYPES].join(', ')}`);
    seen.add(key);
    return { key, label, type };
  });
}

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
  const { name, classSchema, plots, annotationFields, uaSettings } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name required' });
  let annoFields;
  try {
    annoFields = annotationFields ? validateAnnotationFields(annotationFields) : DEFAULT_ANNOTATION_FIELDS;
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const ua = uaSettings || {};
  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const proj = {
    id, name,
    created: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    classSchema: classSchema || [],
    annotationFields: annoFields,
    plots: (plots || []).map(p => ({ ...p, geometry: p.geometry ?? null, meta: p.meta ?? {} })),
    results: {},
    assessmentMode:       ua.assessmentMode       || 'point',
    plotSizeM:            ua.plotSizeM            || 30,
    pointBoxSizeM:        ua.pointBoxSizeM        ?? 30,
    subPointGrid:         ua.subPointGrid         || '5x5',
    cellGrid:             ua.cellGrid             || '3x3',
    gridInnerSizeM:       ua.gridInnerSizeM       ?? 0,
    aggregationRule:      ua.aggregationRule      || 'majority',
    aggregationThreshold: ua.aggregationThreshold || 0.5,
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
  const name = utf8(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Project name required' });

  let classSchema;
  try {
    classSchema = JSON.parse(req.body.classSchema || '[]');
  } catch {
    return res.status(400).json({ error: 'Invalid classSchema JSON' });
  }

  let annotationFields = DEFAULT_ANNOTATION_FIELDS;
  if (req.body.annotationFields) {
    let parsed;
    try { parsed = JSON.parse(req.body.annotationFields); }
    catch { return res.status(400).json({ error: 'Invalid annotationFields JSON' }); }
    try { annotationFields = validateAnnotationFields(parsed); }
    catch (err) { return res.status(400).json({ error: err.message }); }
  }

  let plots = [];
  if (req.file) {
    try {
      plots = await parseGIS(req.file.buffer, req.file.originalname);
    } catch (err) {
      return res.status(400).json({ error: `File parse error: ${err.message}` });
    }
  }

  let uaSettings = {};
  try { uaSettings = JSON.parse(req.body.uaSettings || '{}'); } catch { uaSettings = {}; }

  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const proj = {
    id, name,
    created: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    classSchema,
    annotationFields,
    plots,
    results: {},
    // UA / Assessment settings
    assessmentMode:       uaSettings.assessmentMode       || 'point',
    plotSizeM:            uaSettings.plotSizeM            || 30,
    pointBoxSizeM:        uaSettings.pointBoxSizeM        ?? 30,
    subPointGrid:         uaSettings.subPointGrid         || '5x5',
    cellGrid:             uaSettings.cellGrid             || '3x3',
    gridInnerSizeM:       uaSettings.gridInnerSizeM       ?? 0,
    aggregationRule:      uaSettings.aggregationRule      || 'majority',
    aggregationThreshold: uaSettings.aggregationThreshold || 0.5,
  };
  writeProj(proj);
  res.json({ id });
});

// PATCH /api/projects/:id — incremental update (result, classSchema, annotationFields, ndviCacheUpdate, canopyCacheUpdate, name, lastUsed)
router.patch('/:id', (req, res) => {
  if (!fs.existsSync(projPath(req.params.id))) return res.status(404).json({ error: 'Not found' });
  const proj = readProj(req.params.id);
  const { plotId, result, classSchema, annotationFields, ndviCacheUpdate, canopyCacheUpdate, name, lastUsed, uaSettings } = req.body;

  if (plotId && result) {
    proj.results = proj.results || {};
    proj.results[plotId] = { ...result, savedAt: new Date().toISOString() };
  }
  if (classSchema) proj.classSchema = classSchema;
  if (annotationFields !== undefined) {
    try { proj.annotationFields = validateAnnotationFields(annotationFields); }
    catch (err) { return res.status(400).json({ error: err.message }); }
  }
  if (ndviCacheUpdate && ndviCacheUpdate.plotId != null && Array.isArray(ndviCacheUpdate.months)) {
    proj.ndviCache = proj.ndviCache || {};
    proj.ndviCache[ndviCacheUpdate.plotId] = {
      year: ndviCacheUpdate.year ?? 2025,
      months: ndviCacheUpdate.months,
      fetchedAt: new Date().toISOString(),
    };
  }
  if (canopyCacheUpdate && canopyCacheUpdate.plotId != null) {
    proj.canopyCache = proj.canopyCache || {};
    proj.canopyCache[canopyCacheUpdate.plotId] = {
      year: canopyCacheUpdate.year ?? 2024,
      heightM: canopyCacheUpdate.heightM ?? null,
      fetchedAt: new Date().toISOString(),
    };
  }
  if (name)        proj.name = name;
  if (uaSettings) {
    if (uaSettings.assessmentMode       != null) proj.assessmentMode       = uaSettings.assessmentMode;
    if (uaSettings.plotSizeM            != null) proj.plotSizeM            = uaSettings.plotSizeM;
    if (uaSettings.pointBoxSizeM        != null) proj.pointBoxSizeM        = uaSettings.pointBoxSizeM;
    if (uaSettings.subPointGrid         != null) proj.subPointGrid         = uaSettings.subPointGrid;
    if (uaSettings.cellGrid             != null) proj.cellGrid             = uaSettings.cellGrid;
    if (uaSettings.gridInnerSizeM       != null) proj.gridInnerSizeM       = uaSettings.gridInnerSizeM;
    if (uaSettings.aggregationRule      != null) proj.aggregationRule      = uaSettings.aggregationRule;
    if (uaSettings.aggregationThreshold != null) proj.aggregationThreshold = uaSettings.aggregationThreshold;
  }
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
