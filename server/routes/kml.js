// Google Earth Pro real-time KML sync.
// Point mode:  single red-circle placemark at the plot centre.
// Pixel mode:  UA square polygon + one colour-coded placemark per sub-point.
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

// #RRGGBB → KML aabbggrr (multiplicative colour tint applied to icon image)
function _toKmlColor(hex) {
  if (!hex || hex.length < 7) return 'ff888888';
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `ff${b}${g}${r}`.toLowerCase();
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
    <name>UA — Plot ${plotId}</name>
    <Style>
      <LineStyle><color>ff00aaff</color><width>2</width></LineStyle>
      <PolyStyle><fill>0</fill></PolyStyle>
    </Style>
    <Polygon><outerBoundaryIs><LinearRing>
      <coordinates>${sw} ${se} ${ne} ${nw} ${sw}</coordinates>
    </LinearRing></outerBoundaryIs></Polygon>
  </Placemark>`;
}

function _subPointsKml(lat, lon, pixelMode) {
  const { plotSizeM, subPointGrid, subPointResults = [], selectedIdx } = pixelMode;
  return _subPointPositions(lat, lon, plotSizeM, subPointGrid).map(({ lat: sLat, lon: sLon, idx }) => {
    const result    = subPointResults.find(r => r.idx === idx);
    const isSelected = idx === selectedIdx;
    // orange (#f59e0b) for selected, class colour for classified, grey for unclassified
    const kmlColor = isSelected ? _toKmlColor('#f59e0b')
                   : result     ? _toKmlColor(result.color || '#22c55e')
                   :              'ff666666';
    const scale    = isSelected ? 1.0 : 0.75;
    const name     = result ? `sp_${idx} — ${result.label}` : `sp_${idx}`;
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
router.get('/current.kml', (req, res) => {
  const { lat, lon, id, label, range, pixelMode } = currentPlot;
  const isPixel = pixelMode && pixelMode.plotSizeM;

  const placemarks = isPixel
    ? _uaSquareKml(lat, lon, pixelMode.plotSizeM, id) + _subPointsKml(lat, lon, pixelMode)
    : `
  <Placemark>
    <name>Plot ${id} — ${label}</name>
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
