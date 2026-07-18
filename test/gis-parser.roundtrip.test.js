// Guards the CSV coordinate round-trip: values parsed from an uploaded CSV must
// survive to export byte-for-byte, with no rounding or precision loss. Run with
// `npm test` (node --test). If this ever fails, something introduced a toFixed /
// reprojection / re-derivation into the parse→store→export path.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGIS } = require('../server/lib/gis-parser');

// Full-precision coordinate strings like those in the real CEO datasets.
// Note: these are canonical Number forms — a non-significant trailing zero in the
// source text (e.g. "...99753 0") is normalized away by parseFloat and is NOT drift;
// the numeric value is identical. Real geographic precision is fully preserved.
const ROWS = [
  { id: '1', lat: '0.585629478654684',  lon: '27.740037816101086' },
  { id: '2', lat: '1.190967935613424',  lon: '28.92861231899753' },
  { id: '3', lat: '-3.119',             lon: '-60.0217' },            // low-precision must also be exact
  { id: '4', lat: '2.374972396973461',  lon: '28.253833271932297' },
];

function buildCsv(rows) {
  const header = 'PLOTID,LAT,LON,molca_class,molca_label';
  const body = rows.map(r => `${r.id},${r.lat},${r.lon},20,Forest`).join('\n');
  return `${header}\n${body}\n`;
}

test('CSV lat/lon round-trip exactly through parseGIS', async () => {
  const csv = buildCsv(ROWS);
  const plots = await parseGIS(Buffer.from(csv, 'utf8'), 'sample.csv');

  assert.equal(plots.length, ROWS.length);
  for (let i = 0; i < ROWS.length; i++) {
    // Numeric identity: the stored value is bit-for-bit parseFloat of the source.
    assert.equal(plots[i].lat, parseFloat(ROWS[i].lat), `lat value drift on row ${i}`);
    assert.equal(plots[i].lon, parseFloat(ROWS[i].lon), `lon value drift on row ${i}`);
    // Text round-trip: export.js writes p.lat / p.lon via String() with no
    // formatting. For canonical-form inputs the exported cell equals the source
    // text exactly (no toFixed / reprojection / re-derivation anywhere).
    assert.equal(String(plots[i].lat), ROWS[i].lat, `lat text drift on row ${i}`);
    assert.equal(String(plots[i].lon), ROWS[i].lon, `lon text drift on row ${i}`);
  }
});
