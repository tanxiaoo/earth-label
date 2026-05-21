import { state } from './state.js';

let mapL, mapR;
let _onSubPointClick = null;   // registered by app.js

export function registerSubPointClickHandler(fn) { _onSubPointClick = fn; }
let markerL, squareL, markerR, squareR;
let layerL, layerR;
let geomLayer = null;  // polygon/geometry overlay

// Sub-point marker layers (pixel mode)
let subPointLayersL = [];
let subPointLayersR = [];

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
    // Year-end Wayback snapshots (release ID → date). Public — no API key needed.
    const wayback = {
      '2018': { id: 23448, date: 'Dec 2018' },
      '2019': { id: 4756,  date: 'Dec 2019' },
      '2020': { id: 29260, date: 'Dec 2020' },
      '2021': { id: 26120, date: 'Dec 2021' },
      '2022': { id: 45134, date: 'Dec 2022' },
      '2023': { id: 56102, date: 'Dec 2023' },
      '2024': { id: 16453, date: 'Dec 2024' },
      '2025': { id: 13192, date: 'Dec 2025' },
    };
    const wb = wayback[p1];
    if (wb) return L.tileLayer(`/api/tiles/esri-wayback/${wb.id}/{z}/{y}/{x}`, { maxZoom:19, attribution:`© Esri Wayback ${wb.date}` });
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

// ── Geo helpers ───────────────────────────────────────────────────────────
// Convert a square of sizeM × sizeM (meters) at the given latitude to
// degree offsets. Returns {dlat, dlon} where each is the half-side.
function metersToDeg(sizeM, lat) {
  const half = sizeM / 2;
  const dlat = half / 111320;
  const dlon = half / (111320 * Math.cos(lat * Math.PI / 180));
  return { dlat, dlon };
}

// Generate the {lat, lon, idx} positions for the sub-point grid inside the UA square.
// gridStr: "3x3" | "5x5"  →  rows×cols evenly spanning the full UA square
function generateSubPointPositions(centerLat, centerLon, sizeM, gridStr) {
  const n    = parseInt(gridStr) || 5; // "5x5" → 5
  const { dlat, dlon } = metersToDeg(sizeM, centerLat);
  const positions = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const fR  = n > 1 ? r / (n - 1) : 0.5;
      const fC  = n > 1 ? c / (n - 1) : 0.5;
      positions.push({
        lat: centerLat + dlat * (1 - 2 * fR),   // top → bottom
        lon: centerLon + dlon * (-1 + 2 * fC),  // left → right
        idx: r * n + c,
      });
    }
  }
  return positions;
}

// ── Navigate to plot ──────────────────────────────────────────────────────
export function navigateToPlot(plot) {
  const zoom = state.isFirstPlotLoad ? 19 : mapL.getZoom();
  mapL.setView([plot.lat, plot.lon], zoom);
  if (state.isSplitMode) mapR.setView([plot.lat, plot.lon], state.isFirstPlotLoad ? 19 : mapR.getZoom(), { animate:false });

  // Remove previous layers
  _clearPlotLayers();

  const isPixel = state.assessmentMode === 'pixel';

  if (isPixel) {
    _renderPixelPlot(plot);
  } else {
    _renderPointPlot(plot);
  }

  // Polygon geometry overlay (if plot has geometry from GIS import)
  if (plot.geometry) {
    const geojsonStyle = { color:'#00e5ff', weight:2, fillOpacity:.1, fillColor:'#00e5ff' };
    geomLayer = L.geoJSON(plot.geometry, { style: () => geojsonStyle }).addTo(mapL);
  }
}

function _clearPlotLayers() {
  if (markerL)  { mapL.removeLayer(markerL);  markerL  = null; }
  if (squareL)  { mapL.removeLayer(squareL);  squareL  = null; }
  if (markerR)  { mapR.removeLayer(markerR);  markerR  = null; }
  if (squareR)  { mapR.removeLayer(squareR);  squareR  = null; }
  if (geomLayer){ mapL.removeLayer(geomLayer); geomLayer = null; }
  subPointLayersL.forEach(m => mapL.removeLayer(m));
  subPointLayersR.forEach(m => mapR.removeLayer(m));
  subPointLayersL = [];
  subPointLayersR = [];
}

// Point mode: center dot plus optional focus-box overlay
function _renderPointPlot(plot) {
  const dotStyle = { radius:6, color:'#fff', weight:2, fillColor:'#3b82f6', fillOpacity:.9 };
  markerL = L.circleMarker([plot.lat, plot.lon], dotStyle).addTo(mapL);
  markerR = L.circleMarker([plot.lat, plot.lon], dotStyle).addTo(mapR);

  const boxSize = Number(state.pointBoxSizeM) || 0;
  if (boxSize > 0) {
    const { dlat, dlon } = metersToDeg(boxSize, plot.lat);
    const rect = [
      [plot.lat - dlat, plot.lon - dlon],
      [plot.lat + dlat, plot.lon + dlon],
    ];
    const rectStyle = { color:'#f59e0b', weight:2, fillOpacity:.04, dashArray:'5,5', interactive:false };
    squareL = L.rectangle(rect, rectStyle).addTo(mapL);
    squareR = L.rectangle(rect, rectStyle).addTo(mapR);

    const tooltip = L.tooltip({ permanent:true, direction:'bottom', className:'ua-size-tooltip', offset:[0, 4] })
      .setContent(`${boxSize} m`);
    squareL.bindTooltip(tooltip).openTooltip();
  }
}

// Pixel mode: correctly-sized UA square + sub-point grid
function _renderPixelPlot(plot) {
  const { dlat, dlon } = metersToDeg(state.plotSizeM, plot.lat);

  // UA square (yellow, dashed)
  const rect = [
    [plot.lat - dlat, plot.lon - dlon],
    [plot.lat + dlat, plot.lon + dlon],
  ];
  const rectStyle = { color:'#f59e0b', weight:2, fillOpacity:.04, dashArray:'5,5' };
  squareL = L.rectangle(rect, rectStyle).addTo(mapL);
  squareR = L.rectangle(rect, rectStyle).addTo(mapR);

  // UA size label tooltip (like CEO's "20 m" / "30 m" bar)
  const labelLatLon = [plot.lat - dlat, plot.lon];
  const tooltip = L.tooltip({ permanent:true, direction:'bottom', className:'ua-size-tooltip', offset:[0, 4] })
    .setContent(`${state.plotSizeM} m`);
  squareL.bindTooltip(tooltip).openTooltip();

  // Center marker (blue dot)
  const dotStyle = { radius:5, color:'#fff', weight:2, fillColor:'#3b82f6', fillOpacity:.9 };
  markerL = L.circleMarker([plot.lat, plot.lon], dotStyle).addTo(mapL);
  markerR = L.circleMarker([plot.lat, plot.lon], dotStyle).addTo(mapR);

  // Sub-point grid
  _renderSubPoints(plot);
}

// Draw sub-point circles; colour them if already classified
function _renderSubPoints(plot) {
  const positions  = generateSubPointPositions(plot.lat, plot.lon, state.plotSizeM, state.subPointGrid);
  const plotResults = (state.subPointResults[plot.id] || {});
  const schema      = state.project?.classSchema || [];

  positions.forEach(({ lat, lon, idx }) => {
    const spResult = plotResults[idx];
    const cls      = spResult ? schema.find(c => String(c.code) === String(spResult.code)) : null;

    const styleL = _subPointStyle(idx, spResult, cls);
    const styleR = { ...styleL };

    const mL = L.circleMarker([lat, lon], styleL).addTo(mapL);
    const mR = L.circleMarker([lat, lon], styleR).addTo(mapR);

    mL.on('click', () => { if (_onSubPointClick) _onSubPointClick(idx); });

    subPointLayersL.push(mL);
    subPointLayersR.push(mR);
  });
}

function _subPointStyle(idx, spResult, cls) {
  const isSelected = idx === state.selectedSubPointIdx;
  if (isSelected) {
    // Highlighted (currently active)
    return { radius:5, color:'#fff', weight:2, fillColor:'#f59e0b', fillOpacity:1 };
  }
  if (spResult && cls) {
    // Classified — use class colour
    return { radius:4, color:'rgba(255,255,255,0.6)', weight:1, fillColor: cls.color || '#888', fillOpacity:.9 };
  }
  if (spResult) {
    // Classified but class not in schema (edge case)
    return { radius:4, color:'rgba(255,255,255,0.6)', weight:1, fillColor:'#888', fillOpacity:.9 };
  }
  // Unclassified — solid black dot with thin white border
  return { radius:4, color:'rgba(255,255,255,0.5)', weight:1, fillColor:'#111', fillOpacity:1 };
}

// Refresh one sub-point's visual (call after classifying it)
export function refreshSubPoint(plotId, idx) {
  const positions   = generateSubPointPositions(
    state.plots[state.currentIndex]?.lat,
    state.plots[state.currentIndex]?.lon,
    state.plotSizeM, state.subPointGrid
  );
  const plotResults = state.subPointResults[plotId] || {};
  const schema      = state.project?.classSchema || [];
  const spResult    = plotResults[idx];
  const cls         = spResult ? schema.find(c => String(c.code) === String(spResult.code)) : null;

  const mL = subPointLayersL[idx];
  const mR = subPointLayersR[idx];
  if (!mL || !mR) return;

  const style = _subPointStyle(idx, spResult, cls);
  mL.setStyle(style);
  mR.setStyle(style);
}

// Highlight the newly selected sub-point (deselect previous)
export function highlightSubPoint(prevIdx, nextIdx) {
  const plot       = state.plots[state.currentIndex];
  if (!plot) return;
  const plotResults = state.subPointResults[plot.id] || {};
  const schema      = state.project?.classSchema || [];

  // Deselect previous
  if (prevIdx != null && subPointLayersL[prevIdx]) {
    const pr  = plotResults[prevIdx];
    const cls = pr ? schema.find(c => String(c.code) === String(pr.code)) : null;
    const st  = _subPointStyle(prevIdx, pr, cls);
    subPointLayersL[prevIdx].setStyle(st);
    subPointLayersR[prevIdx].setStyle(st);
  }
  // Select next — keep the map fixed on the whole plot; only restyle the marker
  if (nextIdx != null && subPointLayersL[nextIdx]) {
    const hiStyle = { radius:5, color:'#fff', weight:2, fillColor:'#f59e0b', fillOpacity:1 };
    subPointLayersL[nextIdx].setStyle(hiStyle);
    subPointLayersR[nextIdx].setStyle(hiStyle);
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
