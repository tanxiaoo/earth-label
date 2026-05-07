// Google Earth Pro real-time KML sync.
// `range` is the camera-to-target distance in meters (LookAt/range). It is
// updated by the browser whenever the user moves the toolbar slider, and
// GE Pro picks it up on the next NetworkLink poll (~1s).
const router = require('express').Router();

const DEFAULT_RANGE = 1000;
let currentPlot = { lat: 0, lon: 0, id: '', label: '', range: DEFAULT_RANGE };

router.post('/update', (req, res) => {
  const { lat, lon, id, label, range } = req.body;
  if (lat != null && lon != null) {
    currentPlot.lat   = lat;
    currentPlot.lon   = lon;
    currentPlot.id    = id    || '';
    currentPlot.label = label || '';
  }
  // Range may be sent on its own (slider drag) without coords.
  const r = Number(range);
  if (Number.isFinite(r) && r > 0) currentPlot.range = r;
  res.json({ success: true });
});

router.get('/current.kml', (req, res) => {
  res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>EarthLabel Live</name>
    <LookAt>
      <longitude>${currentPlot.lon}</longitude>
      <latitude>${currentPlot.lat}</latitude>
      <altitude>0</altitude>
      <heading>0</heading>
      <tilt>0</tilt>
      <range>${currentPlot.range}</range>
    </LookAt>
    <Placemark>
      <name>Plot ${currentPlot.id} — ${currentPlot.label}</name>
      <Style><IconStyle><Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon></IconStyle></Style>
      <Point><coordinates>${currentPlot.lon},${currentPlot.lat},0</coordinates></Point>
    </Placemark>
  </Document>
</kml>`);
});

module.exports = router;
