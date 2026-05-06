// Google Earth Pro real-time KML sync (migrated from server.js)
const router = require('express').Router();

let currentPlot = { lat: 0, lon: 0, id: '', label: '' };

router.post('/update', (req, res) => {
  const { lat, lon, id, label } = req.body;
  if (lat != null && lon != null) currentPlot = { lat, lon, id: id || '', label: label || '' };
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
      <range>1500</range>
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
