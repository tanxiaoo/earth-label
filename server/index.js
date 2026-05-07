require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, '../public')));

const DATA_DIR = path.join(__dirname, '../data/projects');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use('/api/keys', require('./routes/keys'));
app.use('/api/presets', require('./routes/presets'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/tiles', require('./routes/tiles'));
app.use('/kml', require('./routes/kml'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  EarthLabel v2  →  http://localhost:${PORT}\n`);
});
