const http = require('http');

let currentPlot = { lat: 0, lon: 0, id: '', label: '' };

const server = http.createServer((req, res) => {
  // CORS headers for the web app
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // Web app posts new coordinates here
  if (req.method === 'POST' && req.url === '/update') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      currentPlot = JSON.parse(body);
      res.writeHead(200);
      res.end('ok');
    });
    return;
  }

  // Google Earth Pro fetches this KML
  if (req.url === '/current_plot.kml') {
    res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
    res.writeHead(200);
    res.end(`<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"
     xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document>
  <name>Current Plot</name>
  <LookAt>
    <longitude>${currentPlot.lon}</longitude>
    <latitude>${currentPlot.lat}</latitude>
    <altitude>0</altitude>
    <range>100</range>
    <tilt>0</tilt>
    <heading>0</heading>
    <altitudeMode>relativeToGround</altitudeMode>
  </LookAt>
  <Placemark>
    <name>Plot #${currentPlot.id} - ${currentPlot.label}</name>
    <Style>
      <IconStyle>
        <scale>1.0</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href>
        </Icon>
        <color>ff0000ff</color>
      </IconStyle>
    </Style>
    <Point>
      <coordinates>${currentPlot.lon},${currentPlot.lat},0</coordinates>
    </Point>
  </Placemark>
</Document>
</kml>`);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(8765, () => console.log('KML server running on http://localhost:8765'));
