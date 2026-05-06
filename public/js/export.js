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

// ── CSV export ────────────────────────────────────────────────────────────
export function exportCSV() {
  const { project, plots } = state;
  if (!plots.length) return;
  const pName = project?.name || 'demo';

  const headers = 'project_name,PLOTID,LAT,LON,ref_code,ref_label,classified_code,classified_label,confidence,notes';
  const rows = plots.map(p => {
    const r = project?.results?.[p.id] || {};
    return [
      `"${pName}"`, p.id, p.lat, p.lon,
      p.refCode ?? '', p.refLabel ?? '',
      r.code ?? '', r.label ?? '',
      r.confidence ?? '', `"${(r.notes || '').replace(/"/g, '""')}"`,
    ].join(',');
  });

  _download([headers, ...rows].join('\n'), `${_safeName(pName)}_results.csv`, 'text/csv');
}

// ── GeoJSON export ────────────────────────────────────────────────────────
export function exportGeoJSON() {
  const { project, plots } = state;
  if (!plots.length) return;
  const pName = project?.name || 'demo';

  const features = plots.map(p => {
    const r = project?.results?.[p.id] || {};
    return {
      type: 'Feature',
      geometry: p.geometry || { type:'Point', coordinates:[p.lon, p.lat] },
      properties: {
        plotId: p.id, lat: p.lat, lon: p.lon,
        refCode: p.refCode, refLabel: p.refLabel,
        classifiedCode: r.code ?? null, classifiedLabel: r.label ?? null,
        confidence: r.confidence ?? null, notes: r.notes ?? null,
        savedAt: r.savedAt ?? null,
        ...p.meta,
      },
    };
  });

  _download(
    JSON.stringify({ type:'FeatureCollection', name: pName, features }, null, 2),
    `${_safeName(pName)}_results.geojson`,
    'application/geo+json'
  );
}

// ── Download project JSON ─────────────────────────────────────────────────
export function exportProjectFile() {
  if (!state.project) return;
  window.location.href = api.exportProjectUrl(state.project.id);
}
