import { state } from './state.js';
import * as api from './api.js';

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
// UA_CSV_COLUMNS and per-sub-point sp_N columns are appended only for pixel
// mode projects so point-mode exports stay clean.
const BASE_CSV_COLUMNS = [
  ['PLOTID',          p => p.id],
  ['LAT',             p => p.lat],
  ['LON',             p => p.lon],
  ['ref_code',        p => p.refCode ?? ''],
  ['ref_label',       p => p.refLabel ?? ''],
  ['class_code',      p => p.resultCode ?? ''],
  ['class_label',     p => p.resultLabel ?? ''],
  ['confidence',      p => p.confidence ?? ''],
  ['image_source',    p => state.project?.results?.[p.id]?.imageSource ?? ''],
  ['image_date',      p => state.project?.results?.[p.id]?.imageDate   ?? ''],
  ['assessment_mode', () => state.assessmentMode],
];

const UA_CSV_COLUMNS = [
  ['ua_size_m',      () => state.plotSizeM],
  ['sub_point_grid', () => state.subPointGrid],
  ['sub_points_json', p => {
    const sp = state.project?.results?.[p.id]?.subPoints;
    return (sp && sp.length) ? JSON.stringify(sp) : '';
  }],
  ['sub_point_total', p => {
    const sp = state.project?.results?.[p.id]?.subPoints;
    return (sp && sp.length) ? sp.length : '';
  }],
  ['sub_point_dominant_count', p => {
    const sp = state.project?.results?.[p.id]?.subPoints;
    if (!sp || !sp.length) return '';
    const winCode = state.project?.results?.[p.id]?.code;
    return sp.filter(s => s.code === winCode).length;
  }],
  ['sub_point_agreement_pct', p => {
    const sp = state.project?.results?.[p.id]?.subPoints;
    if (!sp || !sp.length) return '';
    const winCode = state.project?.results?.[p.id]?.code;
    const dominant = sp.filter(s => s.code === winCode).length;
    return (dominant / sp.length * 100).toFixed(1);
  }],
];

// ── Per-sub-point columns (pixel mode) ───────────────────────────────────
// Generates one column per grid position: sp_0, sp_1, … sp_8 for 3×3.
// Value is the class label assigned to that sub-point, empty if unclassified.
function _subPointCount() {
  if (state.assessmentMode !== 'pixel') return 0;
  const [r, c] = (state.subPointGrid || '3x3').split('x').map(Number);
  return r * c;
}

function _subPointHeaders() {
  return Array.from({ length: _subPointCount() }, (_, i) => `sp_${i}`);
}

function _subPointValues(plot) {
  const n = _subPointCount();
  if (!n) return [];
  const sp = state.project?.results?.[plot.id]?.subPoints || [];
  return Array.from({ length: n }, (_, i) => {
    const pt = sp.find(s => s.idx === i);
    return pt ? pt.label : '';
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
  // annotation columns stay in stable positions.
  const metaKeys = [];
  const seen = new Set();
  for (const p of plots) {
    for (const k of Object.keys(p.meta || {})) {
      if (!seen.has(k)) { seen.add(k); metaKeys.push(k); }
    }
  }

  const isPixel   = state.assessmentMode === 'pixel';
  const uaCols    = isPixel ? UA_CSV_COLUMNS  : [];
  const spHeaders = isPixel ? _subPointHeaders() : [];

  const header = [
    ...BASE_CSV_COLUMNS.map(([h]) => h),
    ...uaCols.map(([h]) => h),
    ...spHeaders,
    ...annoFields.map(f => f.key),
    ...metaKeys,
  ].join(',');

  const rows = plots.map(p => [
    ...BASE_CSV_COLUMNS.map(([, get]) => _csvEscape(get(p))),
    ...uaCols.map(([, get]) => _csvEscape(get(p))),
    ...(isPixel ? _subPointValues(p).map(_csvEscape) : []),
    ...annoFields.map(f => _csvEscape(_annoValue(p, f.key))),
    ...metaKeys.map(k => _csvEscape(p.meta?.[k])),
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
  const base = {
    plot_id:         plot.id,
    lat:             plot.lat,
    lon:             plot.lon,
    ref_code:        plot.refCode ?? '',
    ref_label:       plot.refLabel ?? '',
    class_code:      plot.resultCode ?? '',
    class_label:     plot.resultLabel ?? '',
    confidence:      plot.confidence ?? '',
    image_source:    state.project?.results?.[plot.id]?.imageSource ?? '',
    image_date:      state.project?.results?.[plot.id]?.imageDate   ?? '',
    ...annoProps,
    project_name:    state.project?.name || '',
    saved_at:        state.project?.results?.[plot.id]?.savedAt ?? '',
    assessment_mode: state.assessmentMode,
  };
  if (state.assessmentMode === 'pixel') {
    base.ua_size_m      = state.plotSizeM;
    base.sub_point_grid = state.subPointGrid;
    const sp      = state.project?.results?.[plot.id]?.subPoints || [];
    const winCode = state.project?.results?.[plot.id]?.code;
    const dominant = sp.filter(s => s.code === winCode).length;
    base.sub_points              = sp;
    base.sub_point_total         = sp.length || null;
    base.sub_point_dominant_count = sp.length ? dominant : null;
    base.sub_point_agreement_pct  = sp.length ? parseFloat((dominant / sp.length * 100).toFixed(1)) : null;
  }
  return base;
}

export function exportGeoJSON() {
  const { plots } = state;
  if (!plots.length) return;
  const pName = state.project?.name || 'demo';

  const features = plots.map(p => ({
    type: 'Feature',
    geometry: p.geometry || { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { ..._geoJsonProps(p), ...(p.meta || {}) },
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
