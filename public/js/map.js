import { state } from './state.js';

let mapL, mapR;
let _onSubPointClick = null;   // registered by app.js

export function registerSubPointClickHandler(fn) { _onSubPointClick = fn; }

// Size suffix for the coord readout: UA square in pixel/grid mode, focus box
// in point mode. Empty when the point-mode box is off.
function _boxSizeSuffix() {
  const m = (state.assessmentMode === 'pixel' || state.assessmentMode === 'grid')
    ? Number(state.plotSizeM) || 0
    : Number(state.pointBoxSizeM) || 0;
  return m > 0 ? ` | ${m} m` : '';
}
let markerL, squareL, markerR, squareR;
let innerSquareL, innerSquareR;   // pixel-mode buffer outline (inner box)
let subGridLinesL, subGridLinesR; // pixel-mode lattice lines through the sub-points
let layerL, layerR;
let geomLayer = null;  // polygon/geometry overlay

// Sub-point marker / cell rectangle layers (pixel & grid modes), indexed by idx
let subPointLayersL = [];
let subPointLayersR = [];

// Final map window (review projects only): created on first open
let mapF = null, layerF = null, finalGroup = null;
let subPointLayersF = [];

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

// Leaflet's keyboard handler treats keyCode 54 ('6') as a zoom-out alias for
// the '-' key, and its addHooks sets tabIndex on the map container so the map
// takes focus as soon as a cell is clicked. Class hotkeys are digits, so
// pressing 6 to label both labelled the cell and zoomed the map out. Drop the
// digit alias; the real '-' keys (189 / numpad 109 / Firefox 173) still zoom.
L.Map.Keyboard.prototype.keyCodes.zoomOut = [189, 109, 173];

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
    document.getElementById('coordInfo').textContent      = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)} | z${mapL.getZoom()}${_boxSizeSuffix()}`;
    if (state.isSplitMode) document.getElementById('coordInfoRight').textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)} | z${mapR.getZoom()}${_boxSizeSuffix()}`;
  });
  mapR.on('mousemove', (e) => {
    document.getElementById('coordInfoRight').textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)} | z${mapR.getZoom()}${_boxSizeSuffix()}`;
    document.getElementById('coordInfo').textContent      = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)} | z${mapL.getZoom()}${_boxSizeSuffix()}`;
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

// Grid mode: the side (m) of the box the cells span — the optional inner box
// when set and smaller than the UA square, otherwise the full UA square.
export function gridCoverSizeM() {
  const plot  = Number(state.plotSizeM) || 30;
  const inner = Number(state.gridInnerSizeM) || 0;
  return (inner > 0 && inner < plot) ? inner : plot;
}

// Pixel mode: the side (m) of the box the sub-point lattice spans. 0 /
// invalid = the full UA square (CEO-standard layout with corner points on
// the pixel boundary); a smaller inner box keeps every point buffered
// inside the pixel.
export function pixelCoverSizeM() {
  const plot  = Number(state.plotSizeM) || 30;
  const inner = Number(state.pixelInnerSizeM) || 0;
  return (inner > 0 && inner < plot) ? inner : plot;
}

// Generate the {bounds, idx} rectangles for the cell grid. Cells tile the
// coverSizeM box edge-to-edge; idx is row-major from the top-left, matching
// the sub-point convention.
function generateCellBounds(centerLat, centerLon, coverSizeM, gridStr) {
  const n = parseInt(gridStr) || 3; // "3x3" → 3
  const { dlat, dlon } = metersToDeg(coverSizeM, centerLat);
  const cells = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const north = centerLat + dlat * (1 - 2 * r / n);
      const south = centerLat + dlat * (1 - 2 * (r + 1) / n);
      const west  = centerLon + dlon * (-1 + 2 * c / n);
      const east  = centerLon + dlon * (-1 + 2 * (c + 1) / n);
      cells.push({ bounds: [[south, west], [north, east]], idx: r * n + c });
    }
  }
  return cells;
}

// ── Navigate to plot ──────────────────────────────────────────────────────
export function navigateToPlot(plot) {
  const zoom = state.isFirstPlotLoad ? 19 : mapL.getZoom();
  mapL.setView([plot.lat, plot.lon], zoom);
  if (state.isSplitMode) mapR.setView([plot.lat, plot.lon], state.isFirstPlotLoad ? 19 : mapR.getZoom(), { animate:false });
  if (isFinalMapOpen())  mapF.setView([plot.lat, plot.lon], mapF.getZoom(), { animate:false });
  redrawPlotOverlays(plot);
}

// Redraw the plot's overlays (marker, UA square, units) without moving the
// map — used on navigation and, in reviews, whenever the selected unit or the
// Final labels change (A, B and Final all show the selection).
export function redrawPlotOverlays(plot) {
  _clearPlotLayers();
  if (_isReview() && isFinalMapOpen()) _renderFinalFrame(plot);

  if (state.assessmentMode === 'pixel') {
    _renderPixelPlot(plot);
  } else if (state.assessmentMode === 'grid') {
    _renderGridPlot(plot);
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
  if (innerSquareL) { mapL.removeLayer(innerSquareL); innerSquareL = null; }
  if (innerSquareR) { mapR.removeLayer(innerSquareR); innerSquareR = null; }
  if (subGridLinesL) { mapL.removeLayer(subGridLinesL); subGridLinesL = null; }
  if (subGridLinesR) { mapR.removeLayer(subGridLinesR); subGridLinesR = null; }
  if (geomLayer){ mapL.removeLayer(geomLayer); geomLayer = null; }
  subPointLayersL.forEach(m => mapL.removeLayer(m));
  subPointLayersR.forEach(m => mapR.removeLayer(m));
  subPointLayersL = [];
  subPointLayersR = [];
  finalGroup?.clearLayers();
  subPointLayersF = [];
}

// ── Review projects: what each pane shows ─────────────────────────────────
// Normal projects: both map panes show the working labels ("mine"). Review
// projects: the left map shows labeler A, the right map labeler B, and the
// reviewer's own (Final) labels live in the floating Final map window.
function _isReview() {
  return state.project?.type === 'review';
}

function _paneView(side) {
  if (!_isReview()) return 'mine';
  return side === 'left' ? 'A' : side === 'right' ? 'B' : 'mine';
}

function _reviewItem(plot) {
  return state.review?.items?.[plot?.id] || null;
}

// Panes that draw units right now: { side, target, layers }. `target` is the
// map (or the Final window's layer group) the units are added to.
function _unitPanes() {
  const panes = [
    { side: 'left',  target: mapL, layers: subPointLayersL },
    { side: 'right', target: mapR, layers: subPointLayersR },
  ];
  if (_isReview() && isFinalMapOpen()) panes.push({ side: 'final', target: finalGroup, layers: subPointLayersF });
  return panes;
}

// { results, gridStr, coverM, editable } for the units a pane draws, or null
// when that labeler's result has no units of this mode. A / B units use the
// geometry stored with their result, so they still land where they were drawn.
function _paneUnits(plot, side, mode) {
  const view = _paneView(side);
  if (view === 'mine') {
    return {
      results:  state.subPointResults[plot.id] || {},
      gridStr:  mode === 'grid' ? state.cellGrid : state.subPointGrid,
      coverM:   mode === 'grid' ? gridCoverSizeM() : pixelCoverSizeM(),
      editable: true,
    };
  }
  const r     = _reviewItem(plot)?.[view];
  const units = mode === 'grid' ? r?.cells : r?.subPoints;
  if (!Array.isArray(units)) return null;
  const results = {};
  units.forEach(u => { results[u.idx] = { code: u.code, label: u.label }; });
  const ua = r.uaSizeM ?? state.plotSizeM;
  return {
    results,
    gridStr:  mode === 'grid' ? (r.cellGrid ?? state.cellGrid) : (r.subPointGrid ?? state.subPointGrid),
    coverM:   mode === 'grid' ? (r.cellCoverageM ?? ua) : (r.subPointCoverageM ?? ua),
    editable: false,
  };
}

// Point mode in a review: permanent tag on each pane's marker naming whose
// label it shows ("Ann: Forest"), or the final label in the Final window.
function _reviewTooltip(marker, plot, side) {
  if (!_isReview()) return;
  const view = _paneView(side);
  let text;
  if (view === 'mine') {
    // The class picked but not yet submitted wins over the saved result.
    const picked = (state.project.classSchema || []).find(c => String(c.code) === String(state.selectedClass));
    const r = state.project.results?.[plot.id];
    text = `Final: ${picked?.label || r?.label || '—'}`;
  } else {
    const item = _reviewItem(plot);
    const name = state.review?.labelers?.[view]?.name || view;
    // Compared by an uploaded-file column: tag with that labeler's value.
    const value = state.review?.compareBy ? item?.[`value${view}`] : item?.[view]?.label;
    text = `${name}: ${value ?? '—'}`;
  }
  if (text) marker.bindTooltip(text, { permanent:true, direction:'top', offset:[0,-8], className:'review-tip' });
}

// Point mode: center dot plus optional focus-box overlay
function _renderPointPlot(plot) {
  const dotStyle = { radius:6, color:'#fff', weight:2, fillColor:'#3b82f6', fillOpacity:.9 };
  markerL = L.circleMarker([plot.lat, plot.lon], dotStyle).addTo(mapL);
  markerR = L.circleMarker([plot.lat, plot.lon], dotStyle).addTo(mapR);
  _reviewTooltip(markerL, plot, 'left');
  _reviewTooltip(markerR, plot, 'right');

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

  // Optional buffer: faint outline of the inner box the sub-points span
  const cover = pixelCoverSizeM();
  if (cover < (Number(state.plotSizeM) || 30)) {
    const inner = metersToDeg(cover, plot.lat);
    const innerRect = [
      [plot.lat - inner.dlat, plot.lon - inner.dlon],
      [plot.lat + inner.dlat, plot.lon + inner.dlon],
    ];
    const innerStyle = { color:'rgba(255,255,255,0.55)', weight:1, fillOpacity:0, dashArray:'3,4', interactive:false };
    innerSquareL = L.rectangle(innerRect, innerStyle).addTo(mapL);
    innerSquareR = L.rectangle(innerRect, innerStyle).addTo(mapR);
  }

  // Optional lattice lines through the sub-point rows/columns (under the markers)
  if (state.pixelGridLines) {
    subGridLinesL = _buildSubPointGridLines(plot.lat, plot.lon, cover, state.subPointGrid).addTo(mapL);
    subGridLinesR = _buildSubPointGridLines(plot.lat, plot.lon, cover, state.subPointGrid).addTo(mapR);
  }

  // Center marker (blue dot)
  const dotStyle = { radius:5, color:'#fff', weight:2, fillColor:'#3b82f6', fillOpacity:.9 };
  markerL = L.circleMarker([plot.lat, plot.lon], dotStyle).addTo(mapL);
  markerR = L.circleMarker([plot.lat, plot.lon], dotStyle).addTo(mapR);

  // Sub-point grid
  _renderSubPoints(plot);
}

// Dashed lines along each row and column of the sub-point lattice, so the
// points read as a connected grid. Same fractions as the point positions
// (r/(n-1) across the cover box) — every line passes through its points.
function _buildSubPointGridLines(centerLat, centerLon, coverSizeM, gridStr) {
  const n = parseInt(gridStr) || 5;
  const { dlat, dlon } = metersToDeg(coverSizeM, centerLat);
  const top = centerLat + dlat, bot = centerLat - dlat;
  const left = centerLon - dlon, right = centerLon + dlon;
  const style = { color:'rgba(255,255,255,0.5)', weight:1, dashArray:'3,4', interactive:false };
  const lines = [];
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? i / (n - 1) : 0.5;
    const lat = top - 2 * dlat * f;
    const lon = left + 2 * dlon * f;
    lines.push(L.polyline([[lat, left], [lat, right]], style));
    lines.push(L.polyline([[top, lon], [bot, lon]], style));
  }
  return L.featureGroup(lines);
}

// Unit drawing options for a pane. Normal projects: only the working units
// show the selection and only the left map is clickable. Reviews: every pane
// (A, B, Final) is clickable and shows the selected unit as an orange border
// that keeps the class colour visible.
function _paneOpts(side, src) {
  const review = _isReview();
  return {
    clickable: review || (side === 'left' && src.editable),
    style:     { selectable: review || src.editable, keepColor: review },
  };
}

// Draw sub-point circles per pane; colour them if already classified. The
// working lattice spans pixelCoverSizeM() — the full UA square by default, or
// the buffered inner box when pixelInnerSizeM is set.
function _renderSubPoints(plot) {
  const schema = state.project?.classSchema || [];
  for (const { side, target, layers } of _unitPanes()) {
    const src = _paneUnits(plot, side, 'pixel');
    if (!src) continue;
    const { clickable, style } = _paneOpts(side, src);
    generateSubPointPositions(plot.lat, plot.lon, src.coverM, src.gridStr).forEach(({ lat, lon, idx }) => {
      const spResult = src.results[idx];
      const cls      = spResult ? schema.find(c => String(c.code) === String(spResult.code)) : null;
      const mk = L.circleMarker([lat, lon], { ..._subPointStyle(idx, spResult, cls, style), interactive: clickable }).addTo(target);
      if (clickable) mk.on('click', () => { if (_onSubPointClick) _onSubPointClick(idx); });
      layers[idx] = mk;
    });
  }
}

// opts.selectable: draw the selected unit as selected.
// opts.keepColor: selection is an orange border over the class colour (reviews).
function _subPointStyle(idx, spResult, cls, { selectable = true, keepColor = false } = {}) {
  const fill = spResult ? (cls?.color || '#888') : '#111';
  const isSelected = selectable && idx === state.selectedSubPointIdx;
  if (isSelected && keepColor) {
    return { radius:6, color:'#f59e0b', weight:3, fillColor: fill, fillOpacity:1 };
  }
  if (isSelected) {
    // Highlighted (currently active)
    return { radius:5, color:'#fff', weight:2, fillColor:'#f59e0b', fillOpacity:1 };
  }
  if (spResult) {
    // Classified — use class colour (grey if the class is not in the schema)
    return { radius:4, color:'rgba(255,255,255,0.6)', weight:1, fillColor: fill, fillOpacity:.9 };
  }
  // Unclassified — solid black dot with thin white border
  return { radius:4, color:'rgba(255,255,255,0.5)', weight:1, fillColor: fill, fillOpacity:1 };
}

// Grid mode: UA square (pixel footprint) + clickable cell rectangles
function _renderGridPlot(plot) {
  const { dlat, dlon } = metersToDeg(state.plotSizeM, plot.lat);

  // UA square (yellow, dashed) — the target pixel boundary. Non-interactive
  // so clicks in the buffer ring (when an inner box is set) hit nothing.
  const rect = [
    [plot.lat - dlat, plot.lon - dlon],
    [plot.lat + dlat, plot.lon + dlon],
  ];
  const rectStyle = { color:'#f59e0b', weight:2, fillOpacity:0, dashArray:'5,5', interactive:false };
  squareL = L.rectangle(rect, rectStyle).addTo(mapL);
  squareR = L.rectangle(rect, rectStyle).addTo(mapR);

  // Center marker (blue dot)
  const dotStyle = { radius:5, color:'#fff', weight:2, fillColor:'#3b82f6', fillOpacity:.9, interactive:false };
  markerL = L.circleMarker([plot.lat, plot.lon], dotStyle).addTo(mapL);
  markerR = L.circleMarker([plot.lat, plot.lon], dotStyle).addTo(mapR);

  _renderCells(plot);
}

// Draw the cell rectangles per pane; colour them if already classified.
function _renderCells(plot) {
  const schema = state.project?.classSchema || [];
  for (const { side, target, layers } of _unitPanes()) {
    const src = _paneUnits(plot, side, 'grid');
    if (!src) continue;
    const { clickable, style } = _paneOpts(side, src);
    generateCellBounds(plot.lat, plot.lon, src.coverM, src.gridStr).forEach(({ bounds, idx }) => {
      const result = src.results[idx];
      const cls    = result ? schema.find(c => String(c.code) === String(result.code)) : null;
      const cell = L.rectangle(bounds, { ..._cellStyle(idx, result, cls, style), interactive: clickable }).addTo(target);
      if (clickable) cell.on('click', () => { if (_onSubPointClick) _onSubPointClick(idx); });
      layers[idx] = cell;
    });
  }
}

function _cellStyle(idx, result, cls, { selectable = true, keepColor = false } = {}) {
  const isSelected = selectable && idx === state.selectedSubPointIdx;
  if (isSelected && keepColor) {
    return { color:'#f59e0b', weight:3, fillColor: result ? (cls?.color || '#888') : '#111', fillOpacity: result ? .45 : .05 };
  }
  if (isSelected) {
    // Highlighted (currently active) — orange border + light orange wash
    return { color:'#f59e0b', weight:3, fillColor:'#f59e0b', fillOpacity:.18 };
  }
  if (result) {
    // Classified — translucent class colour so the imagery stays readable
    return { color:'rgba(255,255,255,0.75)', weight:1, fillColor: cls?.color || '#888', fillOpacity:.45 };
  }
  // Unclassified — white grid lines, nearly transparent fill
  return { color:'rgba(255,255,255,0.65)', weight:1, fillColor:'#111', fillOpacity:.05 };
}

// Style for one sub-point marker or cell rectangle, by assessment mode
function _unitStyle(idx, result, cls, opts) {
  return state.assessmentMode === 'grid'
    ? _cellStyle(idx, result, cls, opts)
    : _subPointStyle(idx, result, cls, opts);
}

// Refresh one sub-point's / cell's visual (call after classifying it)
export function refreshSubPoint(plotId, idx) {
  // Reviews draw the selection in A, B and Final — redraw them all.
  if (_isReview()) { _redrawCurrent(); return; }
  const plotResults = state.subPointResults[plotId] || {};
  const schema      = state.project?.classSchema || [];
  const spResult    = plotResults[idx];
  const cls         = spResult ? schema.find(c => String(c.code) === String(spResult.code)) : null;

  const style = _unitStyle(idx, spResult, cls);
  [subPointLayersL, subPointLayersR].forEach(layers => layers[idx]?.setStyle(style));
}

// Highlight the newly selected sub-point / cell (deselect previous)
export function highlightSubPoint(prevIdx, nextIdx) {
  const plot       = state.plots[state.currentIndex];
  if (!plot) return;
  if (_isReview()) { _redrawCurrent(); return; }
  const plotResults = state.subPointResults[plot.id] || {};
  const schema      = state.project?.classSchema || [];
  const panes       = [subPointLayersL, subPointLayersR];

  // Deselect previous
  if (prevIdx != null) {
    const pr  = plotResults[prevIdx];
    const cls = pr ? schema.find(c => String(c.code) === String(pr.code)) : null;
    const st  = _unitStyle(prevIdx, pr, cls, { selectable: false });
    panes.forEach(layers => layers[prevIdx]?.setStyle(st));
  }
  // Select next — keep the map fixed on the whole plot; only restyle the layer
  if (nextIdx != null) {
    const hiStyle = state.assessmentMode === 'grid'
      ? { color:'#f59e0b', weight:3, fillColor:'#f59e0b', fillOpacity:.18 }
      : { radius:5, color:'#fff', weight:2, fillColor:'#f59e0b', fillOpacity:1 };
    panes.forEach(layers => layers[nextIdx]?.setStyle(hiStyle));
  }
}

function _redrawCurrent() {
  const plot = state.plots[state.currentIndex];
  if (plot) redrawPlotOverlays(plot);
}

// ── Final map window (review projects) ───────────────────────────────────
// A floating, draggable, resizable map showing only the reviewer's Final
// labels. Clicking a unit selects it; the class buttons label it.
export function isFinalMapOpen() {
  return !!mapF && !document.getElementById('finalMapWindow')?.classList.contains('hidden');
}

export function openFinalMap() {
  const win = document.getElementById('finalMapWindow');
  if (!win) return;
  win.classList.remove('hidden');
  if (!mapF) {
    mapF = L.map('finalMap', { zoomControl:true });
    finalGroup = L.layerGroup().addTo(mapF);
    // Start on the left map's imagery; afterwards the window has its own choice.
    const { s2Year, esriYear, pYear, pMonth } = _temporalParams('left');
    const year = { sentinel2: s2Year, esri: esriYear, planet: pYear }[state.leftBasemap];
    document.getElementById('finalBasemap').value = state.leftBasemap;
    _fillFinalYears(state.leftBasemap, year);
    if (pMonth) document.getElementById('finalMonth').value = pMonth;
    _applyFinalBasemap();
    new ResizeObserver(() => mapF.invalidateSize()).observe(win);
    _makeDraggable(win, document.getElementById('finalMapHeader'));
  }
  mapF.invalidateSize();
  const plot = state.plots[state.currentIndex];
  if (plot) {
    mapF.setView([plot.lat, plot.lon], mapL.getZoom(), { animate:false });
    redrawPlotOverlays(plot);
  }
}

// ── Final map basemap (its own selector in the window) ──
const FINAL_YEARS = {
  esri:      ['latest', '2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018'],
  sentinel2: ['2018', '2019', '2020', '2021', '2022', '2023', '2024'],
  planet:    ['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'],
};
const FINAL_DEFAULT_YEAR = { esri: 'latest', sentinel2: '2024', planet: '2024' };

function _fillFinalYears(name, year) {
  const sel   = document.getElementById('finalYear');
  const years = FINAL_YEARS[name] || [];
  sel.innerHTML = years.map(y => `<option value="${y}">${y === 'latest' ? 'Latest' : y}</option>`).join('');
  sel.value = years.includes(year) ? year : (FINAL_DEFAULT_YEAR[name] || '');
  sel.style.display = years.length ? '' : 'none';
  document.getElementById('finalMonth').style.display = name === 'planet' ? '' : 'none';
  sel.dataset.basemap = name;
}

function _applyFinalBasemap() {
  const name  = document.getElementById('finalBasemap').value;
  const year  = document.getElementById('finalYear').value;
  const month = document.getElementById('finalMonth').value;
  if (layerF) mapF.removeLayer(layerF);
  layerF = getTileLayer(name, year, month).addTo(mapF);
  layerF.bringToBack();
}

// Called by the window's selectors.
export function setFinalBasemap() {
  const name = document.getElementById('finalBasemap').value;
  if (document.getElementById('finalYear').dataset.basemap !== name) _fillFinalYears(name);
  _applyFinalBasemap();
  // Hand the keyboard back so digit hotkeys label units instead of changing
  // the dropdown's value.
  document.activeElement?.blur();
}

// Imagery shown in the Final window, recorded as a result's image source.
export function finalImageSource() {
  const name  = document.getElementById('finalBasemap')?.value;
  const year  = document.getElementById('finalYear')?.value || '';
  const month = document.getElementById('finalMonth')?.value || '';
  switch (name) {
    case 'esri':      return { source: 'ESRI Wayback', date: year };
    case 'sentinel2': return { source: 'Sentinel-2',   date: year };
    case 'planet':    return { source: 'Planet',       date: `${year}-${month}` };
    case 'bing':      return { source: 'Bing',         date: 'current' };
    default:          return { source: 'Google',       date: 'current' };
  }
}

export function closeFinalMap() {
  document.getElementById('finalMapWindow')?.classList.add('hidden');
  finalGroup?.clearLayers();
  subPointLayersF = [];
}

// UA square / focus box and center marker for the Final window.
function _renderFinalFrame(plot) {
  document.getElementById('finalMapTitle').textContent = `Final — Plot #${plot.id}`;
  const multi = state.assessmentMode === 'pixel' || state.assessmentMode === 'grid';
  document.querySelector('#finalMapWindow .final-map-hint').textContent =
    multi ? 'click a unit, then press its class key (or click a class)' : 'press a class key (or click a class)';
  const size  = multi ? Number(state.plotSizeM) || 30 : Number(state.pointBoxSizeM) || 0;
  if (size > 0) {
    const { dlat, dlon } = metersToDeg(size, plot.lat);
    L.rectangle([[plot.lat - dlat, plot.lon - dlon], [plot.lat + dlat, plot.lon + dlon]],
      { color:'#f59e0b', weight:2, fillOpacity:0, dashArray:'5,5', interactive:false }).addTo(finalGroup);
  }
  const marker = L.circleMarker([plot.lat, plot.lon],
    { radius: multi ? 5 : 6, color:'#fff', weight:2, fillColor:'#3b82f6', fillOpacity:.9, interactive:false }).addTo(finalGroup);
  if (!multi) _reviewTooltip(marker, plot, 'final');
}

function _makeDraggable(win, handle) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, select')) return;
    const startX = e.clientX, startY = e.clientY;
    const { left, top } = win.getBoundingClientRect();
    const move = (ev) => {
      win.style.left = `${Math.max(0, left + ev.clientX - startX)}px`;
      win.style.top  = `${Math.max(0, top  + ev.clientY - startY)}px`;
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

// ── Basemap switching ─────────────────────────────────────────────────────
export function setMapLayer(side, name) {
  const isLeft = side === 'left';
  const m      = isLeft ? mapL : mapR;
  const oldL   = isLeft ? layerL : layerR;

  if (isLeft) state.leftBasemap = name; else state.rightBasemap = name;

  const { s2Year, esriYear, pYear, pMonth } = _temporalParams(side);
  const newLayer = _tileLayerFor(side);

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

// Temporal params from a pane's own selectors
function _temporalParams(side) {
  const isLeft = side === 'left';
  return {
    s2Year:   document.getElementById(isLeft ? 's2-year-left'      : 's2-year-right')?.value,
    esriYear: document.getElementById(isLeft ? 'esri-year-left'    : 'esri-year-right')?.value,
    pYear:    document.getElementById(isLeft ? 'planet-year-left'  : 'planet-year-right')?.value,
    pMonth:   document.getElementById(isLeft ? 'planet-month-left' : 'planet-month-right')?.value,
  };
}

// A fresh tile layer matching a pane's current basemap + temporal params
function _tileLayerFor(side) {
  const name = side === 'left' ? state.leftBasemap : state.rightBasemap;
  const { s2Year, esriYear, pYear, pMonth } = _temporalParams(side);
  if (name === 'sentinel2') return getTileLayer('sentinel2', s2Year);
  if (name === 'esri')      return getTileLayer('esri', esriYear);
  if (name === 'planet')    return getTileLayer('planet', pYear, pMonth);
  return getTileLayer(name);
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
