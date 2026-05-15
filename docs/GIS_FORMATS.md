# GIS File Formats

Reference for the file formats EarthLabel can import, with the field-name conventions used during parsing.

All formats are normalised into the same internal `Plot` shape:

```ts
{
  id:       string,            // plot identifier
  lat:      number,
  lon:      number,
  refCode:  string | null,     // optional reference class code
  refLabel: string | null,     // optional reference class label
  geometry: GeoJSON | null,    // full geometry preserved if input was a polygon
  meta:     { [key]: any },    // any other attributes from the source file
}
```

---

## CSV

Plain comma-separated. The parser auto-detects column names case-insensitively.

### Required columns

| Field     | Accepted aliases                                       |
|-----------|--------------------------------------------------------|
| Latitude  | `LAT`, `latitude`, `y`, `Y`                            |
| Longitude | `LON`, `LONG`, `LONGITUDE`, `lng`, `LNG`, `x`, `X`     |

### Optional columns

| Field            | Accepted aliases |
|------------------|------------------|
| Plot ID          | `PLOTID`, `ID`, `FID`, `NAME`, `Plot_ID` |
| Reference code   | `ref_code` |
| Reference label  | `ref_label` |

Header matching is **exact and case-insensitive** — `ref_code` and `REF_CODE` are both recognized, but variants like `molca_class`, `molca_class_2024`, or `class_code` are not. If `Plot ID` is absent, the row index is used. All other columns become `meta` and are preserved in both the CSV and GeoJSON exports.

### Example

```csv
PLOTID,LAT,LON,ref_code,ref_label,observed_by
1,0.5856,27.7400,20,Forest,xt
2,7.5617,13.7757,5,Shrubland,am
3,7.2322,17.5794,5,Shrubland,am
```

---

## GeoJSON

Standard GeoJSON `FeatureCollection` or single `Feature`.

### Geometry support

| GeoJSON type        | How it's handled |
|---------------------|------------------|
| `Point`             | Coordinates used directly |
| `MultiPoint`        | First point used |
| `Polygon`           | Centroid of outer ring used for navigation; full geometry preserved and drawn on map |
| `MultiPolygon`      | Centroid of first polygon used; full geometry preserved |
| Other (LineString…) | Skipped |

### Property mapping

The same field-name conventions as CSV apply to the `properties` object. Unrecognised properties end up in `meta`.

### Example (Points)

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [27.74, 0.5856] },
      "properties": { "PLOTID": "1", "ref_code": 20, "ref_label": "Forest" }
    }
  ]
}
```

### Example (Polygons)

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[27.73, 0.58], [27.75, 0.58], [27.75, 0.60], [27.73, 0.60], [27.73, 0.58]]]
      },
      "properties": { "PLOTID": "p1", "ref_label": "Forest" }
    }
  ]
}
```

The polygon outline appears on the left map in cyan; the centroid is the navigation target.

---

## KML / KMZ

Standard OGC KML 2.2 / 2.3.

- **`.kml`** — plain XML
- **`.kmz`** — zipped archive containing one `.kml`

The parser uses [`@tmcw/togeojson`](https://github.com/placemark/togeojson) under the hood — the same library used by Mapbox / Placemark — so results match what you'd see in those tools.

### What's recognised
- `<Placemark>` with `<Point>` → Point plot
- `<Placemark>` with `<Polygon>` → Polygon plot (centroid + geometry)
- `<name>` → plot ID
- `<ExtendedData>` `<SimpleData name="…">` and `<Data name="…">` → properties
- KML styles, schemas → ignored

### Example

```xml
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>1</name>
      <ExtendedData>
        <Data name="ref_code"><value>20</value></Data>
        <Data name="ref_label"><value>Forest</value></Data>
      </ExtendedData>
      <Point><coordinates>27.74,0.5856,0</coordinates></Point>
    </Placemark>
  </Document>
</kml>
```

---

## Shapefile (zipped)

Upload as a `.zip` containing at minimum:

| File   | Required | Purpose |
|--------|----------|---------|
| `.shp` | yes      | Geometry |
| `.dbf` | yes      | Attribute table |
| `.shx` | yes      | Geometry index |
| `.prj` | optional | Projection (currently assumed WGS84) |
| `.cpg` | optional | Codepage for `.dbf` |

> **All files at the root of the ZIP**, no subfolders.

The parser uses Mike Bostock's [`shapefile`](https://github.com/mbostock/shapefile) library and converts to GeoJSON internally.

### How to make one in QGIS

1. Right-click your layer in QGIS → **Export → Save Features As…**
2. Format: `ESRI Shapefile`, Filename: anywhere
3. Click OK
4. Select the resulting `.shp`, `.shx`, `.dbf` (and `.prj` if present) in your file explorer
5. Right-click → **Compress** / **Send to Compressed Folder** → upload that `.zip`

### Coordinate system

The parser assumes coordinates are in WGS84 (EPSG:4326). If your shapefile is in a different CRS:

- **In QGIS:** before exporting, right-click the layer → **Export → Save Features As…** → set "CRS" to **EPSG:4326 — WGS 84**
- The `.prj` file is **not** parsed; it's just preserved with the file

---

## File-format Detection

EarthLabel detects format by file extension:

| Ext       | Handler |
|-----------|---------|
| `.csv`    | CSV parser |
| `.geojson`, `.json` | GeoJSON parser |
| `.kml`    | KML parser |
| `.kmz`    | KMZ unzip → KML parser |
| `.zip`    | Shapefile unzip → shapefile parser |

If your file has an unusual extension, rename it before upload.

---

## Output Formats (Export)

### CSV (`↓ CSV` button)

```csv
PLOTID,LAT,LON,ref_code,ref_label,class_code,class_label,confidence,notes,Tile_ID,source
1,0.5856,27.7400,20,Forest,20,Forest,High,,35PRQ,reused_2019
2,7.5617,13.7757,5,Shrubland,8,Cropland,Medium,"misclassified in 2019",36QXT,fresh_2024
```

- Identity columns are uppercase (`PLOTID`, `LAT`, `LON`); result columns are snake-case.
- Any unknown columns from the input (e.g. `Tile_ID`, `source` above) are appended after `notes` in their original order, so the export is a strict superset of the input.
- Project name and timestamps are intentionally omitted from the CSV — the project name lives in the filename, and per-row timestamps clutter analytical exports. Use the GeoJSON export or the project `.json` if you need them.
- A UTF-8 BOM is prepended so Excel renders non-ASCII project / class names correctly.
- Flat, suitable for analysis in Pandas / Excel / R.

### GeoJSON (`↓ GeoJSON` button)

Feature collection with the **original input geometry** preserved (Point or Polygon). Properties use the canonical snake-case schema, and any unknown columns from the upload round-trip alongside:

```json
{
  "type": "FeatureCollection",
  "name": "Nairobi 2024",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [27.74, 0.5856] },
      "properties": {
        "plot_id": "1",
        "lat": 0.5856,
        "lon": 27.74,
        "ref_code": "20",
        "ref_label": "Forest",
        "class_code": 20,
        "class_label": "Forest",
        "confidence": "High",
        "notes": "",
        "project_name": "Nairobi 2024",
        "saved_at": "2026-05-06T11:05:23.000Z"
      }
    }
  ]
}
```

Loadable directly in QGIS, ArcGIS, leaflet, mapbox, etc.

### Freshness

Both CSV and GeoJSON exports read from live in-memory state, so re-classifying any plot (including back-navigation) is reflected on the **next** download immediately.

### Project file (`↓` in sidebar)

Full project state as one `.json` — re-importable via the **📂** button. Preserves plots, results, schema, timestamps, and original geometry.
