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
// Identity columns are uppercase to match common GIS conventions (PLOTID,
// LAT, LON). project_name and saved_at are intentionally excluded — the
// project name is in the filename, and the timestamp is not useful in the
// per-row results table.
const FIXED_CSV_COLUMNS = [
  ['PLOTID',      p => p.id],
  ['LAT',         p => p.lat],
  ['LON',         p => p.lon],
  ['ref_code',    p => p.refCode ?? ''],
  ['ref_label',   p => p.refLabel ?? ''],
  ['class_code',  p => p.resultCode ?? ''],
  ['class_label', p => p.resultLabel ?? ''],
  ['confidence',  p => p.confidence ?? ''],
];

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

  const header = [
    ...FIXED_CSV_COLUMNS.map(([h]) => h),
    ...annoFields.map(f => f.key),
    ...metaKeys,
  ].join(',');

  const rows = plots.map(p => [
    ...FIXED_CSV_COLUMNS.map(([, get]) => _csvEscape(get(p))),
    ...annoFields.map(f => _csvEscape(_annoValue(p, f.key))),
    ...metaKeys.map(k => _csvEscape(p.meta?.[k])),
  ].join(','));

  const filename = `${_safeName(state.project?.name)}_results.csv`;
  // Prepend UTF-8 BOM so Excel opens non-ASCII characters correctly.
  _download('﻿' + [header, ...rows].join('\n'), filename, 'text/csv;charset=utf-8');
}

// ── GeoJSON export ────────────────────────────────────────────────────────
// GeoJSON properties keep snake_case lowercase, including project_name and
// saved_at — programmatic consumers benefit from that metadata.
function _geoJsonProps(plot) {
  const annoFields = _annoFields();
  const annoProps = {};
  for (const f of annoFields) annoProps[f.key] = _annoValue(plot, f.key);
  return {
    plot_id:      plot.id,
    lat:          plot.lat,
    lon:          plot.lon,
    ref_code:     plot.refCode ?? '',
    ref_label:    plot.refLabel ?? '',
    class_code:   plot.resultCode ?? '',
    class_label:  plot.resultLabel ?? '',
    confidence:   plot.confidence ?? '',
    ...annoProps,
    project_name: state.project?.name || '',
    saved_at:     state.project?.results?.[plot.id]?.savedAt ?? '',
  };
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
