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
const CSV_COLUMNS = [
  ['PLOTID',      p => p.id],
  ['LAT',         p => p.lat],
  ['LON',         p => p.lon],
  ['ref_code',    p => p.refCode ?? ''],
  ['ref_label',   p => p.refLabel ?? ''],
  ['class_code',  p => p.resultCode ?? ''],
  ['class_label', p => p.resultLabel ?? ''],
  ['confidence',  p => p.confidence ?? ''],
  ['notes',       p => p.notes ?? ''],
];

export function exportCSV() {
  const { plots } = state;
  if (!plots.length) return;

  const header = CSV_COLUMNS.map(([h]) => h).join(',');
  const rows   = plots.map(p => CSV_COLUMNS.map(([, get]) => _csvEscape(get(p))).join(','));

  const filename = `${_safeName(state.project?.name)}_results.csv`;
  // Prepend UTF-8 BOM so Excel opens non-ASCII characters correctly.
  _download('﻿' + [header, ...rows].join('\n'), filename, 'text/csv;charset=utf-8');
}

// ── GeoJSON export ────────────────────────────────────────────────────────
// GeoJSON properties keep snake_case lowercase, including project_name and
// saved_at — programmatic consumers benefit from that metadata.
function _geoJsonProps(plot) {
  return {
    plot_id:      plot.id,
    lat:          plot.lat,
    lon:          plot.lon,
    ref_code:     plot.refCode ?? '',
    ref_label:    plot.refLabel ?? '',
    class_code:   plot.resultCode ?? '',
    class_label:  plot.resultLabel ?? '',
    confidence:   plot.confidence ?? '',
    notes:        plot.notes ?? '',
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
