const path = require('path');
const fs = require('fs');
const os = require('os');

// ── helpers ────────────────────────────────────────────────────────────────

function centroid(coordinates) {
  const ring = Array.isArray(coordinates[0][0]) ? coordinates[0] : coordinates;
  let x = 0, y = 0;
  for (const [cx, cy] of ring) { x += cx; y += cy; }
  return [x / ring.length, y / ring.length];
}

function featureToPlot(feature, idx) {
  if (!feature || !feature.geometry) return null;
  const props = feature.properties || {};
  const geomType = feature.geometry.type;
  const coords = feature.geometry.coordinates;

  let lat, lon, geometry = null;

  if (geomType === 'Point') {
    [lon, lat] = coords;
  } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
    const ring = geomType === 'MultiPolygon' ? coords[0] : coords;
    [lon, lat] = centroid(ring);
    geometry = feature.geometry;
  } else if (geomType === 'MultiPoint') {
    [lon, lat] = coords[0];
  } else {
    return null;
  }

  if (!isFinite(lat) || !isFinite(lon)) return null;

  // Try to find a sensible plot ID
  const id = String(
    props.PLOTID || props.plotid || props.ID || props.id ||
    props.FID || props.fid || props.NAME || props.name ||
    props.Plot_ID || props.plot_id || (idx + 1)
  );

  // Reference class (optional)
  const refCode = props.molca_class ?? props.ref_code ?? props.class_code ??
                  props.CLASS_CODE ?? props.ref_class ?? null;
  const refLabel = props.molca_label ?? props.ref_label ?? props.class_label ??
                   props.CLASS_LABEL ?? props.label ?? null;

  // Keep all other attributes as metadata
  const meta = {};
  for (const [k, v] of Object.entries(props)) {
    if (!['PLOTID','plotid','ID','id','FID','fid','NAME','name',
          'Plot_ID','plot_id','LAT','lat','LON','lon','LATITUDE',
          'LONGITUDE','molca_class','molca_label','ref_code','ref_label',
          'class_code','class_label','CLASS_CODE','CLASS_LABEL'].includes(k)) {
      meta[k] = v;
    }
  }

  return { id, lat, lon, refCode: refCode !== null ? String(refCode) : null,
           refLabel: refLabel !== null ? String(refLabel) : null,
           geometry, meta };
}

// ── CSV ────────────────────────────────────────────────────────────────────

function parseCSV(content) {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV has no data rows');

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

  const col = (names) => {
    for (const n of names) {
      const i = headers.findIndex(h => h.toLowerCase() === n.toLowerCase());
      if (i !== -1) return i;
    }
    return -1;
  };

  const idIdx    = col(['PLOTID','plotid','ID','id','FID','fid','name','NAME']);
  const latIdx   = col(['LAT','lat','LATITUDE','latitude','y','Y']);
  const lonIdx   = col(['LON','lon','LONG','long','LONGITUDE','longitude','x','X','lng','LNG']);
  const rcIdx    = col(['molca_class','ref_code','class_code','CLASS_CODE','ref_class','refcode','refCode']);
  const rlIdx    = col(['molca_label','ref_label','class_label','CLASS_LABEL','ref_label','refLabel','reflabel']);

  if (latIdx === -1 || lonIdx === -1) throw new Error('CSV must have LAT and LON columns');

  const plots = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    // Handle quoted fields with commas
    const vals = raw.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g)
                    ?.map(v => v.replace(/^"|"$/g, '').trim()) || raw.split(',');

    const lat = parseFloat(vals[latIdx]);
    const lon = parseFloat(vals[lonIdx]);
    if (!isFinite(lat) || !isFinite(lon)) continue;

    const id = idIdx !== -1 ? (vals[idIdx] || String(i)) : String(i);
    const refCode  = rcIdx !== -1 ? (vals[rcIdx]  || null) : null;
    const refLabel = rlIdx !== -1 ? (vals[rlIdx] || null) : null;

    const meta = {};
    headers.forEach((h, hi) => {
      if (![idIdx,latIdx,lonIdx,rcIdx,rlIdx].includes(hi)) meta[h] = vals[hi] ?? '';
    });

    plots.push({ id, lat, lon, refCode, refLabel, geometry: null, meta });
  }
  return plots;
}

// ── GeoJSON ────────────────────────────────────────────────────────────────

function parseGeoJSON(content) {
  const geojson = JSON.parse(content);
  const features = geojson.type === 'FeatureCollection' ? geojson.features
                 : geojson.type === 'Feature'           ? [geojson]
                 : [];
  return features.map(featureToPlot).filter(Boolean);
}

// ── KML / KMZ ─────────────────────────────────────────────────────────────

function parseKML(content) {
  const { DOMParser } = require('@xmldom/xmldom');
  const { kml } = require('@tmcw/togeojson');
  const doc = new DOMParser().parseFromString(content, 'text/xml');
  const geojson = kml(doc);
  return geojson.features.map(featureToPlot).filter(Boolean);
}

function parseKMZ(buffer) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(buffer);
  const entry = zip.getEntries().find(e => e.entryName.endsWith('.kml'));
  if (!entry) throw new Error('No .kml file found inside KMZ');
  return parseKML(entry.getData().toString('utf8'));
}

// ── Shapefile ──────────────────────────────────────────────────────────────

async function parseShapefileZip(buffer) {
  const AdmZip = require('adm-zip');
  const shapefile = require('shapefile');

  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const shpEntry = entries.find(e => e.entryName.toLowerCase().endsWith('.shp'));
  const dbfEntry = entries.find(e => e.entryName.toLowerCase().endsWith('.dbf'));
  if (!shpEntry) throw new Error('No .shp file found in ZIP');

  // Write to temp files (shapefile package needs paths)
  const tmpId = `el_${Date.now()}`;
  const shpPath = path.join(os.tmpdir(), `${tmpId}.shp`);
  const dbfPath = path.join(os.tmpdir(), `${tmpId}.dbf`);
  fs.writeFileSync(shpPath, shpEntry.getData());
  if (dbfEntry) fs.writeFileSync(dbfPath, dbfEntry.getData());

  try {
    const features = [];
    const source = await shapefile.open(shpPath, dbfEntry ? dbfPath : undefined);
    let result = await source.read();
    while (!result.done) {
      features.push(result.value);
      result = await source.read();
    }
    return features.map(featureToPlot).filter(Boolean);
  } finally {
    try { fs.unlinkSync(shpPath); } catch (_) {}
    try { fs.unlinkSync(dbfPath); } catch (_) {}
  }
}

// ── Main dispatcher ────────────────────────────────────────────────────────

async function parseGIS(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.csv')                          return parseCSV(buffer.toString('utf8'));
  if (ext === '.geojson' || ext === '.json')   return parseGeoJSON(buffer.toString('utf8'));
  if (ext === '.kml')                          return parseKML(buffer.toString('utf8'));
  if (ext === '.kmz')                          return parseKMZ(buffer);
  if (ext === '.zip')                          return parseShapefileZip(buffer);
  throw new Error(`Unsupported format: ${ext}. Supported: .csv .geojson .json .kml .kmz .zip`);
}

module.exports = { parseGIS };
