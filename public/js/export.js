import { state } from './state.js';
import * as api from './api.js';
import { gridCoverSizeM } from './map.js';

function _download(content, filename, mime) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([content], { type: mime })),
    download: filename,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

function _safeName(name) {
  return (name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function _csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── CSV export ────────────────────────────────────────────────────────────
// BASE_CSV_COLUMNS are always present regardless of assessment mode.
// UA_CSV_COLUMNS / GRID_CSV_COLUMNS and the per-unit sp_N / cell_N columns
// are appended when the project's current mode uses them OR any stored
// result carries that kind of data — a project whose mode was switched
// mid-way exports both blocks, each row filled from its own stored result.
function _resultOf(plotId) {
  return state.project?.results?.[plotId];
}

// Per-row assessment mode: stored with the result at submit time; inferred
// from the stored data shape for results saved before that field existed;
// falls back to the project's current mode for unclassified rows.
function _rowMode(plot) {
  const r = _resultOf(plot.id);
  if (r?.assessmentMode) return r.assessmentMode;
  if (r?.cells)          return 'grid';
  if (r?.subPoints)      return 'pixel';
  if (r)                 return 'point';
  return state.assessmentMode;
}

const BASE_CSV_COLUMNS = [
  ['PLOTID',          p => p.id],
  ['LAT',             p => p.lat],
  ['LON',             p => p.lon],
  ['ref_code',        p => p.refCode ?? ''],
  ['ref_label',       p => p.refLabel ?? ''],
  ['class_code',      p => p.resultCode ?? ''],
  ['class_label',     p => p.resultLabel ?? ''],
  ['confidence',      p => p.confidence ?? ''],
  ['image_source',    p => _resultOf(p.id)?.imageSource      ?? ''],
  ['image_date',      p => _resultOf(p.id)?.imageDate        ?? ''],
  ['time_spent_s',    p => _resultOf(p.id)?.timeSpentSeconds ?? ''],
  ['assessment_mode', p => _rowMode(p)],
];

// Shared by pixel and grid blocks: the UA square side the row was assessed
// with (stored per result; current setting for legacy / unclassified rows).
const UA_SIZE_COLUMN = ['ua_size_m', p => {
  const r = _resultOf(p.id);
  if (r?.uaSizeM != null) return r.uaSizeM;
  if (r?.subPoints || r?.cells) return state.plotSizeM;               // legacy multi-unit rows
  return (!r && state.assessmentMode !== 'point') ? state.plotSizeM : '';
}];

const UA_CSV_COLUMNS = [
  ['sub_point_grid', p => {
    const r = _resultOf(p.id);
    if (r?.subPoints) return r.subPointGrid ?? state.subPointGrid;
    return (!r && state.assessmentMode === 'pixel') ? state.subPointGrid : '';
  }],
  ['sub_points_json', p => {
    const sp = _resultOf(p.id)?.subPoints;
    return (sp && sp.length) ? JSON.stringify(sp) : '';
  }],
  ['sub_point_total', p => {
    const sp = _resultOf(p.id)?.subPoints;
    return (sp && sp.length) ? sp.length : '';
  }],
  ['sub_point_dominant_count', p => {
    const sp = _resultOf(p.id)?.subPoints;
    if (!sp || !sp.length) return '';
    const winCode = _resultOf(p.id)?.code;
    return sp.filter(s => s.code === winCode).length;
  }],
  ['sub_point_agreement_pct', p => {
    const sp = _resultOf(p.id)?.subPoints;
    if (!sp || !sp.length) return '';
    const winCode = _resultOf(p.id)?.code;
    const dominant = sp.filter(s => s.code === winCode).length;
    return (dominant / sp.length * 100).toFixed(1);
  }],
];

// ── Grid-mode columns ─────────────────────────────────────────────────────
// cell_class_pct_json is the per-class density breakdown, e.g.
// [{"code":13,"label":"Built-up","pct":66.7},{"code":20,"label":"Forest","pct":33.3}]
// — the 0–100% cover fraction of the pixel (or inner box) per class.
function _cellsOf(plotId) {
  return _resultOf(plotId)?.cells;
}

function _cellClassBreakdown(plotId) {
  const cells = _cellsOf(plotId);
  if (!cells || !cells.length) return null;
  const counts = {};
  cells.forEach(c => {
    const k = String(c.code);
    counts[k] = counts[k] || { code: c.code, label: c.label, n: 0 };
    counts[k].n++;
  });
  return Object.values(counts)
    .sort((a, b) => b.n - a.n)
    .map(c => ({ code: c.code, label: c.label, pct: parseFloat((c.n / cells.length * 100).toFixed(1)) }));
}

const GRID_CSV_COLUMNS = [
  ['cell_grid', p => {
    const r = _resultOf(p.id);
    if (r?.cells) return r.cellGrid ?? state.cellGrid;
    return (!r && state.assessmentMode === 'grid') ? state.cellGrid : '';
  }],
  ['cell_coverage_m', p => {
    const r = _resultOf(p.id);
    if (r?.cells) return r.cellCoverageM ?? gridCoverSizeM();
    return (!r && state.assessmentMode === 'grid') ? gridCoverSizeM() : '';
  }],
  ['cells_json', p => {
    const cells = _cellsOf(p.id);
    return (cells && cells.length) ? JSON.stringify(cells) : '';
  }],
  ['cell_total', p => {
    const cells = _cellsOf(p.id);
    return (cells && cells.length) ? cells.length : '';
  }],
  ['cell_dominant_count', p => {
    const cells = _cellsOf(p.id);
    if (!cells || !cells.length) return '';
    const winCode = _resultOf(p.id)?.code;
    return cells.filter(c => c.code === winCode).length;
  }],
  ['cell_dominant_pct', p => {
    const cells = _cellsOf(p.id);
    if (!cells || !cells.length) return '';
    const winCode = _resultOf(p.id)?.code;
    const dominant = cells.filter(c => c.code === winCode).length;
    return (dominant / cells.length * 100).toFixed(1);
  }],
  ['cell_class_pct_json', p => {
    const breakdown = _cellClassBreakdown(p.id);
    return breakdown ? JSON.stringify(breakdown) : '';
  }],
];

// ── Per-unit columns: sp_0 … sp_{n-1} (pixel) / cell_0 … cell_{n-1} (grid),
// row-major from top-left. Value is the class label assigned to that unit,
// empty if unclassified. Column count covers the current setting (when that
// mode is active) AND the largest stored result, so no stored unit is lost
// after a settings change.
function _gridSize(gridStr) {
  const [r, c] = (gridStr || '3x3').split('x').map(Number);
  return (r * c) || 0;
}

function _unitColCount(key, activeMode, activeGridStr) {
  let n = state.assessmentMode === activeMode ? _gridSize(activeGridStr) : 0;
  for (const r of Object.values(state.project?.results || {})) {
    if (!Array.isArray(r?.[key])) continue;
    // max idx + 1, not length — legacy stored arrays may be sparse
    for (const u of r[key]) if (u.idx + 1 > n) n = u.idx + 1;
  }
  return n;
}

function _unitHeaders(prefix, n) {
  return Array.from({ length: n }, (_, i) => `${prefix}_${i}`);
}

function _unitValues(plot, key, n) {
  if (!n) return [];
  const units = _resultOf(plot.id)?.[key] || [];
  return Array.from({ length: n }, (_, i) => {
    const u = units.find(s => s.idx === i);
    return u ? u.label : '';
  });
}

// Per-project annotation fields default to a single text field named `notes`
// when the project doesn't define any — matches pre-feature behavior.
const DEFAULT_ANNO_FIELDS = [{ key: 'notes', label: 'Notes', type: 'text' }];
function _annoFields() {
  const f = state.project?.annotationFields;
  return (Array.isArray(f) && f.length) ? f : DEFAULT_ANNO_FIELDS;
}

// Read an annotation value from a plot, falling back to legacy top-level
// `notes` so projects saved before annotationFields existed still export.
function _annoValue(plot, key) {
  return plot.annotations?.[key] ?? (key === 'notes' ? plot.notes ?? '' : '');
}

export function exportCSV() {
  const { plots } = state;
  if (!plots.length) return;

  const annoFields = _annoFields();

  // Union of meta keys across all plots, preserving first-seen order — keeps
  // upload columns like Tile_ID, source, sample_id, molca_class_2024 round-
  // trippable through CSV. Appended at the tail so the fixed columns and
  // annotation columns stay in stable positions. Keys that collide with an
  // emitted column (typical when a previous export was re-imported) are
  // dropped: the freshly computed value is authoritative.
  const metaKeys = [];
  const seen = new Set();
  for (const p of plots) {
    for (const k of Object.keys(p.meta || {})) {
      if (!seen.has(k)) { seen.add(k); metaKeys.push(k); }
    }
  }

  // Include a mode's column block when the project currently uses that mode
  // or when any stored result was submitted in it (mixed-mode projects).
  const results  = state.project?.results || {};
  const anySub   = plots.some(p => results[p.id]?.subPoints?.length);
  const anyCells = plots.some(p => results[p.id]?.cells?.length);
  const incPixel = state.assessmentMode === 'pixel' || anySub;
  const incGrid  = state.assessmentMode === 'grid'  || anyCells;

  const uaCols = [
    ...((incPixel || incGrid) ? [UA_SIZE_COLUMN] : []),
    ...(incPixel ? UA_CSV_COLUMNS   : []),
    ...(incGrid  ? GRID_CSV_COLUMNS : []),
  ];
  const spCount   = incPixel ? _unitColCount('subPoints', 'pixel', state.subPointGrid) : 0;
  const cellCount = incGrid  ? _unitColCount('cells',     'grid',  state.cellGrid)     : 0;

  const emittedCols = [
    ...BASE_CSV_COLUMNS.map(([h]) => h),
    ...uaCols.map(([h]) => h),
    ..._unitHeaders('sp', spCount),
    ..._unitHeaders('cell', cellCount),
    ...annoFields.map(f => f.key),
  ];
  const emittedColSet = new Set(emittedCols);
  const tailMetaKeys  = metaKeys.filter(k => !emittedColSet.has(k));

  const header = [
    ...emittedCols,
    ...tailMetaKeys,
  ].join(',');

  const rows = plots.map(p => [
    ...BASE_CSV_COLUMNS.map(([, get]) => _csvEscape(get(p))),
    ...uaCols.map(([, get]) => _csvEscape(get(p))),
    ..._unitValues(p, 'subPoints', spCount).map(_csvEscape),
    ..._unitValues(p, 'cells', cellCount).map(_csvEscape),
    ...annoFields.map(f => _csvEscape(_annoValue(p, f.key))),
    ...tailMetaKeys.map(k => _csvEscape(p.meta?.[k])),
  ].join(','));

  const filename = `${_safeName(state.project?.name)}_results.csv`;
  // Prepend UTF-8 BOM so Excel opens non-ASCII characters correctly.
  _download('﻿' + [header, ...rows].join('\n'), filename, 'text/csv;charset=utf-8');
}

// ── GeoJSON export ────────────────────────────────────────────────────────
function _geoJsonProps(plot) {
  const annoFields = _annoFields();
  const annoProps  = {};
  for (const f of annoFields) annoProps[f.key] = _annoValue(plot, f.key);
  const r = _resultOf(plot.id);
  const base = {
    plot_id:         plot.id,
    lat:             plot.lat,
    lon:             plot.lon,
    ref_code:        plot.refCode ?? '',
    ref_label:       plot.refLabel ?? '',
    class_code:      plot.resultCode ?? '',
    class_label:     plot.resultLabel ?? '',
    confidence:      plot.confidence ?? '',
    image_source:     r?.imageSource     ?? '',
    image_date:       r?.imageDate       ?? '',
    time_spent_s:     r?.timeSpentSeconds ?? null,
    ...annoProps,
    project_name:    state.project?.name || '',
    saved_at:        r?.savedAt ?? '',
    assessment_mode: _rowMode(plot),
  };
  // Emit each mode's properties from the feature's own stored result — an
  // unclassified feature gets the current mode's settings as a preview.
  if (r?.subPoints || (!r && state.assessmentMode === 'pixel')) {
    const sp      = r?.subPoints || [];
    const winCode = r?.code;
    const dominant = sp.filter(s => s.code === winCode).length;
    base.ua_size_m      = r?.uaSizeM ?? state.plotSizeM;
    base.sub_point_grid = r?.subPointGrid ?? state.subPointGrid;
    base.sub_points              = sp;
    base.sub_point_total         = sp.length || null;
    base.sub_point_dominant_count = sp.length ? dominant : null;
    base.sub_point_agreement_pct  = sp.length ? parseFloat((dominant / sp.length * 100).toFixed(1)) : null;
  }
  if (r?.cells || (!r && state.assessmentMode === 'grid')) {
    const cells   = r?.cells || [];
    const winCode = r?.code;
    const dominant = cells.filter(c => c.code === winCode).length;
    base.ua_size_m       = r?.uaSizeM ?? state.plotSizeM;
    base.cell_grid       = r?.cellGrid ?? state.cellGrid;
    base.cell_coverage_m = r?.cellCoverageM ?? gridCoverSizeM();
    base.cells               = cells;
    base.cell_total          = cells.length || null;
    base.cell_dominant_count = cells.length ? dominant : null;
    base.cell_dominant_pct   = cells.length ? parseFloat((dominant / cells.length * 100).toFixed(1)) : null;
    base.cell_class_pct      = _cellClassBreakdown(plot.id);
  }
  return base;
}

export function exportGeoJSON() {
  const { plots } = state;
  if (!plots.length) return;
  const pName = state.project?.name || 'demo';

  // Meta first, computed props last — a re-imported export file carries our
  // own column names in meta, and the freshly computed values must win.
  const features = plots.map(p => ({
    type: 'Feature',
    geometry: p.geometry || { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { ...(p.meta || {}), ..._geoJsonProps(p) },
  }));

  _download(
    JSON.stringify({ type: 'FeatureCollection', name: pName, features }, null, 2),
    `${_safeName(pName)}_results.geojson`,
    'application/geo+json'
  );
}

// ── Download project JSON ─────────────────────────────────────────────────
export function exportProjectFile() {
  if (!state.project) return;
  window.location.href = api.exportProjectUrl(state.project.id);
}
