import { state } from './state.js';

let mapL, mapR;
let markerL, squareL, markerR, squareR;
let layerL, layerR;
let geomLayer = null;  // polygon/geometry overlay

// ── BingLayer ────────────────────────────────────────────────────────────
const BingLayer = L.TileLayer.extend({
  getTileUrl(coords) {
    const zoom = this._getZoomForUrl();
    let q = '';
    for (let i = zoom; i > 0; i--) {
      let d = 0; const m = 1 << (i - 1);
      if ((coords.x & m) !== 0) d++;
      if ((coords.y & m) !== 0) d += 2;
      q += d;
    }
    return `https://ecn.t0.tiles.virtualearth.net/tiles/a${q}.jpeg?g=587`;
  }
});

// ── Tile URL builders ────────────────────────────────────────────────────
export function getTileLayer(name, p1, p2) {
  if (name === 'google')
    return L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { maxZoom:21, attribution:'© Google' });

  if (name === 'esri') {
    if (p1 === '2024') return L.tileLayer('/api/tiles/esri-wayback/16453/{z}/{y}/{x}', { maxZoom:19, attribution:'© Esri Wayback Dec 2024' });
    if (p1 === '2019') return L.tileLayer('/api/tiles/esri-wayback/4756/{z}/{y}/{x}',  { maxZoom:19, attribution:'© Esri Wayback Dec 2019' });
    return L.tileLayer('/api/tiles/esri-world/{z}/{y}/{x}', { maxZoom:19, attribution:'© Esri' });
  }

  if (name === 'bing')
    return new BingLayer('', { maxZoom:19, attribution:'© Microsoft Bing' });

  if (name === 'sentinel2')
    return L.tileLayer(`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${p1 || '2024'}_3857/default/g/{z}/{y}/{x}.jpg`, { maxZoom:19, attribution:'Sentinel-2 cloudless © EOX' });

  if (name === 'planet') {
    const year = p1 || '2024', month = p2 || '06';
    const period = `global_monthly_${year}_${month}_mosaic`;
    return L.tileLayer(`/api/tiles/planet/${period}/{z}/{x}/{y}`, { maxZoom:18, attribution:'© Planet Labs PBC' });
  }

  return L.tileLayer('', { maxZoom:18 });
}

// ── Init ─────────────────────────────────────────────────────────────────
export function initMap() {
  mapL = L.map('map',      { center:[5,20], zoom:4, zoomControl:true });
  mapR = L.map('mapRight', { center:[5,20], zoom:4, zoomControl:true });

  layerL = getTileLayer('google').addTo(mapL);
  layerR = getTileLayer('sentinel2','2024').addTo(mapR);

  // Sync
  mapL.on('move', () => { if (state.isSplitMode && !mapR._isSyncing) _sync(mapL, mapR); });
  mapR.on('move', () => { if (state.isSplitMode && !mapL._isSyncing) _sync(mapR, mapL); });

  mapL.on('mousemove', (e) => {
    document.getElementById('coordInfo').textContent      = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)} | z${mapL.getZoom()}`;
    if (state.isSplitMode) document.getElementById('coordInfoRight').textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)} | z${mapR.getZoom()}`;
  });
  mapR.on('mousemove', (e) => {
    document.getElementById('coordInfoRight').textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)} | z${mapR.getZoom()}`;
    document.getElementById('coordInfo').textContent      = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)} | z${mapL.getZoom()}`;
  });
}

function _sync(src, tgt) {
  tgt._isSyncing = true;
  tgt.setView(src.getCenter(), src.getZoom(), { animate:false });
  tgt._isSyncing = false;
}

// ── Navigate to plot ──────────────────────────────────────────────────────
export function navigateToPlot(plot) {
  const zoom = state.isFirstPlotLoad ? 17 : mapL.getZoom();
  mapL.setView([plot.lat, plot.lon], zoom);
  if (state.isSplitMode) mapR.setView([plot.lat, plot.lon], state.isFirstPlotLoad ? 17 : mapR.getZoom(), { animate:false });

  // Markers
  if (markerL) mapL.removeLayer(markerL);
  if (squareL) mapL.removeLayer(squareL);
  if (markerR) mapR.removeLayer(markerR);
  if (squareR) mapR.removeLayer(squareR);
  if (geomLayer) { mapL.removeLayer(geomLayer); geomLayer = null; }

  const dotStyle = { radius:6, color:'#fff', weight:2, fillColor:'#3b82f6', fillOpacity:.9 };
  markerL = L.circleMarker([plot.lat, plot.lon], dotStyle).addTo(mapL);
  markerR = L.circleMarker([plot.lat, plot.lon], dotStyle).addTo(mapR);

  // 70m reference square
  const d = 0.00035;
  const rect = [[plot.lat - d, plot.lon - d],[plot.lat + d, plot.lon + d]];
  const rectStyle = { color:'#f59e0b', weight:2, fillOpacity:.05, dashArray:'5,5' };
  squareL = L.rectangle(rect, rectStyle).addTo(mapL);
  squareR = L.rectangle(rect, rectStyle).addTo(mapR);

  // Polygon geometry overlay (if plot has geometry from GIS import)
  if (plot.geometry) {
    const geojsonStyle = { color:'#00e5ff', weight:2, fillOpacity:.1, fillColor:'#00e5ff' };
    geomLayer = L.geoJSON(plot.geometry, { style: () => geojsonStyle }).addTo(mapL);
  }
}

// ── Basemap switching ─────────────────────────────────────────────────────
export function setMapLayer(side, name) {
  const isLeft = side === 'left';
  const m      = isLeft ? mapL : mapR;
  const oldL   = isLeft ? layerL : layerR;

  if (isLeft) state.leftBasemap = name; else state.rightBasemap = name;

  // Gather temporal params from the correct selectors
  const s2Year     = document.getElementById(isLeft ? 's2-year-left' : 's2-year-right')?.value;
  const esriYear   = document.getElementById(isLeft ? 'esri-year-left' : 'esri-year-right')?.value;
  const pYear      = document.getElementById(isLeft ? 'planet-year-left' : 'planet-year-right')?.value;
  const pMonth     = document.getElementById(isLeft ? 'planet-month-left' : 'planet-month-right')?.value;

  let newLayer;
  if      (name === 'sentinel2') newLayer = getTileLayer('sentinel2', s2Year);
  else if (name === 'esri')      newLayer = getTileLayer('esri', esriYear);
  else if (name === 'planet')    newLayer = getTileLayer('planet', pYear, pMonth);
  else                           newLayer = getTileLayer(name);

  m.removeLayer(oldL);
  newLayer.addTo(m);
  if (isLeft) layerL = newLayer; else layerR = newLayer;

  // Update mini-basemap active state
  const pane = document.getElementById(isLeft ? 'mini-basemaps-left' : 'mini-basemaps-right');
  pane.querySelectorAll('.mini-btn').forEach(b => b.classList.toggle('active', b.dataset.layer === name));

  // Show/hide temporal selectors in mini panel
  _showMini(pane, 's2-year',     isLeft ? 's2-year-left'      : 's2-year-right',      name === 'sentinel2');
  _showMini(pane, 'esri-year',   isLeft ? 'esri-year-left'    : 'esri-year-right',    name === 'esri');
  _showMini(pane, 'planet-year', isLeft ? 'planet-year-left'  : 'planet-year-right',  name === 'planet');
  _showMini(pane, 'planet-month',isLeft ? 'planet-month-left' : 'planet-month-right', name === 'planet');

  // Sync global toolbar (left map only, non-split)
  if (isLeft && !state.isSplitMode) _syncGlobalToolbar(name, s2Year, esriYear, pYear, pMonth);
}

function _showMini(_pane, _prefix, id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? 'inline-block' : 'none';
}

function _syncGlobalToolbar(name, s2Year, esriYear, pYear, pMonth) {
  document.querySelectorAll('.global-basemaps .basemap-btn[id^=btn-]').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-${name}`)?.classList.add('active');
  const show = (id, cond) => { const el = document.getElementById(id); if (el) el.style.display = cond ? 'inline-block' : 'none'; };
  show('s2-year',     name === 'sentinel2');
  show('esri-year',   name === 'esri');
  show('planet-year', name === 'planet');
  show('planet-month',name === 'planet');
  if (s2Year)  { const e = document.getElementById('s2-year');     if(e) e.value = s2Year; }
  if (esriYear){ const e = document.getElementById('esri-year');   if(e) e.value = esriYear; }
  if (pYear)   { const e = document.getElementById('planet-year'); if(e) e.value = pYear; }
  if (pMonth)  { const e = document.getElementById('planet-month');if(e) e.value = pMonth; }
}

export function switchBasemap(name) { setMapLayer('left', name); }

export function updateEsriYear() {
  document.getElementById('esri-year-left').value = document.getElementById('esri-year').value;
  setMapLayer('left', 'esri');
}
export function updateSentinel2Year() {
  document.getElementById('s2-year-left').value = document.getElementById('s2-year').value;
  setMapLayer('left', 'sentinel2');
}
export function updatePlanetParams() {
  document.getElementById('planet-year-left').value  = document.getElementById('planet-year').value;
  document.getElementById('planet-month-left').value = document.getElementById('planet-month').value;
  setMapLayer('left', 'planet');
}

// ── Split view ────────────────────────────────────────────────────────────
export function toggleSplitView() {
  state.isSplitMode = !state.isSplitMode;
  document.getElementById('pane-right').classList.toggle('split-hidden', !state.isSplitMode);
  document.getElementById('btn-split').classList.toggle('active', state.isSplitMode);
  document.body.classList.toggle('split-mode', state.isSplitMode);
  document.getElementById('mini-basemaps-left').style.display = state.isSplitMode ? 'flex' : 'none';
  mapL.invalidateSize();
  mapR.invalidateSize();
  if (state.isSplitMode && state.plots[state.currentIndex]) {
    const p = state.plots[state.currentIndex];
    mapR.setView([p.lat, p.lon], mapL.getZoom(), { animate:false });
  }
}

export { mapL, mapR };
