// Google Earth Pro real-time KML sync.
// Point mode:  single red-circle placemark at the plot centre.
// Pixel mode:  UA square polygon + one colour-coded placemark per sub-point.
// Grid mode:   UA square polygon + one colour-coded cell polygon per cell.
//   Colours: orange = currently selected, class colour = classified, grey = unclassified.
const router = require('express').Router();

const DEFAULT_RANGE = 1000;
let currentPlot = { lat: 0, lon: 0, id: '', label: '', range: DEFAULT_RANGE, pixelMode: null };

router.post('/update', (req, res) => {
  const { lat, lon, id, label, range, pixelMode } = req.body;
  if (lat != null && lon != null) {
    currentPlot.lat   = lat;
    currentPlot.lon   = lon;
    currentPlot.id    = id    || '';
    currentPlot.label = label || '';
  }
  const r = Number(range);
  if (Number.isFinite(r) && r > 0) currentPlot.range = r;
  if (pixelMode !== undefined) currentPlot.pixelMode = pixelMode || null;
  res.json({ success: true });
});

// ── Geo helpers (mirrors map.js — must stay in sync) ─────────────────────
function _metersToDeg(sizeM, lat) {
  const half = sizeM / 2;
  return {
    dlat: half / 111320,
    dlon: half / (111320 * Math.cos(lat * Math.PI / 180)),
  };
}

function _subPointPositions(centerLat, centerLon, sizeM, gridStr) {
  const n = parseInt(gridStr) || 5;
  const { dlat, dlon } = _metersToDeg(sizeM, centerLat);
  const out = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const fR = n > 1 ? r / (n - 1) : 0.5;
      const fC = n > 1 ? c / (n - 1) : 0.5;
      out.push({
        lat: centerLat + dlat * (1 - 2 * fR),
        lon: centerLon + dlon * (-1 + 2 * fC),
        idx: r * n + c,
      });
    }
  }
  return out;
}

// Grid mode: {bounds:{south,west,north,east}, idx} rectangles tiling the
// coverSizeM box, row-major from top-left (mirrors map.js generateCellBounds)
function _cellBounds(centerLat, centerLon, coverSizeM, gridStr) {
  const n = parseInt(gridStr) || 3;
  const { dlat, dlon } = _metersToDeg(coverSizeM, centerLat);
  const out = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      out.push({
        north: centerLat + dlat * (1 - 2 * r / n),
        south: centerLat + dlat * (1 - 2 * (r + 1) / n),
        west:  centerLon + dlon * (-1 + 2 * c / n),
        east:  centerLon + dlon * (-1 + 2 * (c + 1) / n),
        idx: r * n + c,
      });
    }
  }
  return out;
}

// Escape user-provided text (class labels, plot ids) for XML — a bare & or <
// in a <name> makes GEP reject the whole NetworkLink document.
function _xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// #RRGGBB → KML aabbggrr (multiplicative colour tint applied to icon image)
function _toKmlColor(hex, alpha = 'ff') {
  if (!hex || hex.length < 7) return `${alpha}888888`;
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `${alpha}${b}${g}${r}`.toLowerCase();
}

// ── KML fragment builders ─────────────────────────────────────────────────
function _uaSquareKml(lat, lon, sizeM, plotId) {
  const { dlat, dlon } = _metersToDeg(sizeM, lat);
  const sw = `${lon - dlon},${lat - dlat},0`;
  const se = `${lon + dlon},${lat - dlat},0`;
  const ne = `${lon + dlon},${lat + dlat},0`;
  const nw = `${lon - dlon},${lat + dlat},0`;
  return `
  <Placemark>
    <name>UA — Plot ${_xmlEscape(plotId)}</name>
    <Style>
      <LineStyle><color>ff00aaff</color><width>2</width></LineStyle>
      <PolyStyle><fill>0</fill></PolyStyle>
    </Style>
    <Polygon><outerBoundaryIs><LinearRing>
      <coordinates>${sw} ${se} ${ne} ${nw} ${sw}</coordinates>
    </LinearRing></outerBoundaryIs></Polygon>
  </Placemark>`;
}

// Grid mode: one semi-transparent polygon per cell, coloured like the web UI
function _cellsKml(lat, lon, pixelMode) {
  const { plotSizeM, cellGrid, gridInnerSizeM, subPointResults = [], selectedIdx } = pixelMode;
  const inner = Number(gridInnerSizeM) || 0;
  const coverSizeM = (inner > 0 && inner < plotSizeM) ? inner : plotSizeM;
  return _cellBounds(lat, lon, coverSizeM, cellGrid).map(({ north, south, west, east, idx }) => {
    const result     = subPointResults.find(r => r.idx === idx);
    const isSelected = idx === selectedIdx;
    // ~55% fill opacity ('8c') so the imagery stays readable under the colour
    const fillColor = isSelected ? _toKmlColor('#f59e0b', '8c')
                    : result     ? _toKmlColor(result.color || '#22c55e', '8c')
                    :              '26666666';
    const lineColor = isSelected ? _toKmlColor('#f59e0b') : 'b3ffffff';
    const lineWidth = isSelected ? 3 : 1;
    const name      = result ? `cell_${idx} — ${_xmlEscape(result.label)}` : `cell_${idx}`;
    const sw = `${west},${south},0`;
    const se = `${east},${south},0`;
    const ne = `${east},${north},0`;
    const nw = `${west},${north},0`;
    return `
  <Placemark>
    <name>${name}</name>
    <Style>
      <LineStyle><color>${lineColor}</color><width>${lineWidth}</width></LineStyle>
      <PolyStyle><color>${fillColor}</color><fill>1</fill><outline>1</outline></PolyStyle>
    </Style>
    <Polygon><outerBoundaryIs><LinearRing>
      <coordinates>${sw} ${se} ${ne} ${nw} ${sw}</coordinates>
    </LinearRing></outerBoundaryIs></Polygon>
  </Placemark>`;
  }).join('');
}

// Dashed lattice lines through the sub-point rows/columns (mirrors the
// browser overlay when the project's pixelGridLines toggle is on).
function _subGridLinesKml(lat, lon, coverSizeM, gridStr) {
  const n = parseInt(gridStr) || 5;
  const { dlat, dlon } = _metersToDeg(coverSizeM, lat);
  const top = lat + dlat, bot = lat - dlat;
  const left = lon - dlon, right = lon + dlon;
  const style = '<Style><LineStyle><color>80ffffff</color><width>1</width></LineStyle></Style>';
  let segs = '';
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? i / (n - 1) : 0.5;
    const y = top - 2 * dlat * f;
    const x = left + 2 * dlon * f;
    segs += `
    <Placemark>${style}<LineString><coordinates>${left},${y},0 ${right},${y},0</coordinates></LineString></Placemark>
    <Placemark>${style}<LineString><coordinates>${x},${top},0 ${x},${bot},0</coordinates></LineString></Placemark>`;
  }
  return segs;
}

function _subPointsKml(lat, lon, pixelMode) {
  const { plotSizeM, subPointGrid, pixelInnerSizeM, pixelGridLines, subPointResults = [], selectedIdx } = pixelMode;
  // Optional buffer: the lattice spans a smaller centered box instead of the full UA square
  const inner = Number(pixelInnerSizeM) || 0;
  const coverSizeM = (inner > 0 && inner < plotSizeM) ? inner : plotSizeM;
  const gridLines = pixelGridLines ? _subGridLinesKml(lat, lon, coverSizeM, subPointGrid) : '';
  return gridLines + _subPointPositions(lat, lon, coverSizeM, subPointGrid).map(({ lat: sLat, lon: sLon, idx }) => {
    const result    = subPointResults.find(r => r.idx === idx);
    const isSelected = idx === selectedIdx;
    // orange (#f59e0b) for selected, class colour for classified, grey for unclassified
    const kmlColor = isSelected ? _toKmlColor('#f59e0b')
                   : result     ? _toKmlColor(result.color || '#22c55e')
                   :              'ff666666';
    const scale    = isSelected ? 1.0 : 0.75;
    const name     = result ? `sp_${idx} — ${_xmlEscape(result.label)}` : `sp_${idx}`;
    return `
  <Placemark>
    <name>${name}</name>
    <Style>
      <IconStyle>
        <color>${kmlColor}</color><scale>${scale}</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/shaded_dot.png</href></Icon>
      </IconStyle>
      <LabelStyle><scale>0</scale></LabelStyle>
    </Style>
    <Point><coordinates>${sLon},${sLat},0</coordinates></Point>
  </Placemark>`;
  }).join('');
}

// ── KML endpoint ──────────────────────────────────────────────────────────
// google_earth_link.kml has <flyToView>1</flyToView> on the NetworkLink,
// which tells GEP to fly the camera to the <LookAt> in this response on
// every poll. The zoom slider works by updating range here each second.
router.get('/current.kml', (req, res) => {
  const { lat, lon, id, label, range, pixelMode } = currentPlot;
  const isMulti = pixelMode && pixelMode.plotSizeM;
  const isGrid  = isMulti && pixelMode.cellGrid;

  const placemarks = isMulti
    ? _uaSquareKml(lat, lon, pixelMode.plotSizeM, id) +
      (isGrid ? _cellsKml(lat, lon, pixelMode) : _subPointsKml(lat, lon, pixelMode))
    : `
  <Placemark>
    <name>Plot ${_xmlEscape(id)} — ${_xmlEscape(label)}</name>
    <Style><IconStyle><Icon>
      <href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href>
    </Icon></IconStyle></Style>
    <Point><coordinates>${lon},${lat},0</coordinates></Point>
  </Placemark>`;

  res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>EarthLabel Live</name>
    <LookAt>
      <longitude>${lon}</longitude>
      <latitude>${lat}</latitude>
      <altitude>0</altitude>
      <heading>0</heading>
      <tilt>0</tilt>
      <range>${range}</range>
    </LookAt>
    ${placemarks}
  </Document>
</kml>`);
});

module.exports = router;
