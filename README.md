# EarthLabel

**Satellite Image Interpretation Platform — v2**

A self-hosted web app for satellite image interpretation and land-cover validation. Built as a lighter, faster alternative to Collect Earth Online with multi-source high-resolution imagery, dynamic class schemas, and GIS file support.

> **v2 is a full rewrite.** The single-file `molca_validator.html` is preserved for reference, but the running app is now a proper Express + ES-modules web app with a backend, persistent project files on disk, and server-side API key management.

---

## Features

- **Multi-source basemaps** — Google Satellite, ESRI World Imagery (latest + Wayback 2024/2019), Bing, Sentinel-2 cloudless (2018–2024), Planet PlanetScope (monthly mosaics 2016–2025)
- **Dual map / split view** — Compare two basemaps side-by-side with synced pan/zoom
- **Dynamic classification schemas** — 10 built-in real-world LULC presets (MOLCA, CORINE, IGBP/MODIS, ESA CCI, NLCD, IPCC, Anderson/USGS, FROM-GLC, Binary, Custom). Each project carries its own schema; edit, add, delete classes with color picker and keyboard shortcuts.
- **GIS import** — `.csv` · `.geojson` · `.kml` · `.kmz` · Shapefile (`.zip`). Points and Polygons supported; polygon centroids used for navigation, full geometry drawn on the map.
- **Server-side API key management** — Planet/ESRI keys stored in `.env` and proxied through the backend. Keys never reach the browser.
- **Project files on disk** — Each project = one JSON file in `data/projects/`. Portable, version-controllable, easy to share. Export/import any project as a `.json` file.
- **Auto-save** — Every classification result persists immediately via incremental PATCH to the backend.
- **Multiple export formats** — CSV (flat results) and GeoJSON (with original geometry preserved).
- **Google Earth Pro sync** — Live KML feed at `/kml/current.kml` auto-flies Google Earth Pro to the current plot.
- **Keyboard shortcuts** — Rapid classification with per-class hotkeys, confidence levels (`h`/`m`/`l`), `Enter` to submit, arrow keys to navigate.

---

## Quick Start

### 1. Install dependencies

```bash
cd earth-label
npm install
```

### 2. Start the server

```bash
npm start
# → http://localhost:3000
```

That's it. Open the URL in your browser.

### 3. Add API keys (optional, for Planet/ESRI imagery)

Click the **⚙ Settings** icon (top-left) and paste your Planet and/or ESRI API keys. They're written to `.env` on the server — never sent back to the browser. Both legacy bare-value `.env` files and proper `KEY=VALUE` files are auto-detected and migrated.

---

## Built-in Classification Schemas

| Preset                           | Classes | Source |
|----------------------------------|--------:|--------|
| Binary (Positive / Negative)     | 2       | Custom |
| MOLCA 2019                       | 10      | Morocco Land Cover Assessment |
| CORINE Land Cover Level 1        | 5       | EEA Copernicus |
| CORINE Land Cover Level 2        | 15      | EEA Copernicus |
| IGBP / MODIS MCD12Q1             | 17      | NASA MODIS |
| ESA CCI Land Cover               | 22      | ESA CCI v2.1 |
| NLCD 2021                        | 16      | USGS MRLC |
| IPCC Land Use Categories         | 6       | IPCC 2006 GHG Inventory Guidelines |
| Anderson / USGS Level I          | 9       | USGS Prof. Paper 964 |
| FROM-GLC                         | 10      | Tsinghua University |
| Custom                           | —       | Start blank |

All presets use the official colormap from each source where available.

---

## Architecture

```
earth-label/
├── .env                       ← API keys (auto-managed, gitignored)
├── server/
│   ├── index.js               ← Express server (port 3000)
│   ├── lib/
│   │   ├── env-manager.js     ← .env read/write with legacy auto-migration
│   │   ├── class-presets.js   ← All 10 LULC presets
│   │   └── gis-parser.js      ← CSV / GeoJSON / KML / Shapefile parser
│   └── routes/
│       ├── keys.js            ← /api/keys/*
│       ├── presets.js         ← /api/presets/*
│       ├── projects.js        ← /api/projects/*  (CRUD, file upload, import/export)
│       ├── tiles.js           ← /api/tiles/*    (Planet/ESRI proxy)
│       └── kml.js             ← /kml/*          (Google Earth Pro sync)
├── public/                    ← Static assets served by Express
│   ├── index.html
│   ├── css/app.css
│   └── js/                    ← ES modules (no build step)
│       ├── app.js             ← Main orchestrator
│       ├── api.js             ← Backend client
│       ├── state.js           ← App state
│       ├── map.js             ← Leaflet dual-map + tile layers
│       ├── classes.js         ← Class editor + render
│       └── export.js          ← CSV / GeoJSON / project export
└── data/projects/             ← Project JSON files (gitignored)
```

See [docs/](docs/) for detailed guides.

---

## Documentation

- [docs/USER_GUIDE.md](docs/USER_GUIDE.md) — End-user walkthrough: creating projects, importing GIS data, classifying, keyboard shortcuts
- [docs/SCHEMAS.md](docs/SCHEMAS.md) — All 10 LULC presets with class lists, sources, and citations
- [docs/DEVELOPER.md](docs/DEVELOPER.md) — Architecture, API reference, how to add features
- [docs/GIS_FORMATS.md](docs/GIS_FORMATS.md) — Supported import formats and field-name conventions

---

## CSV Format (input)

Your input CSV must contain `LAT` and `LON` columns. Plot ID and reference class are optional.

```csv
PLOTID,LAT,LON,ref_code,ref_label
1,0.5856,27.7400,20,Forest
2,7.5617,13.7757,5,Shrubland
```

Recognised aliases:

| Field         | Accepted column names |
|---------------|------------------------|
| Plot ID       | `PLOTID`, `ID`, `FID`, `NAME` |
| Latitude      | `LAT`, `LATITUDE`, `y` |
| Longitude     | `LON`, `LONG`, `LONGITUDE`, `x`, `lng` |
| Ref. code     | `molca_class`, `ref_code`, `class_code`, `ref_class` |
| Ref. label    | `molca_label`, `ref_label`, `class_label`, `label` |

Unknown columns are preserved as plot metadata and round-trip into GeoJSON exports.

---

## GIS Import

Drag-and-drop or click to upload:

| Format        | Extensions               | Notes |
|---------------|--------------------------|-------|
| CSV           | `.csv`                   | Auto-detect columns above |
| GeoJSON       | `.geojson`, `.json`      | `Point` and `Polygon` geometries supported |
| KML           | `.kml`                   | Placemarks (points and polygons) |
| KMZ           | `.kmz`                   | Zipped KML |
| Shapefile     | `.zip` of `.shp+.dbf+.shx` | All in one zip |

For polygon features the centroid is used for map navigation; the full geometry is stored on the plot, drawn as a cyan outline on the map, and round-trips into the GeoJSON export.

---

## API Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET`    | `/api/keys/status`              | Returns `{planet: bool, esri: bool}` |
| `POST`   | `/api/keys`                     | Save Planet/ESRI keys to `.env` |
| `DELETE` | `/api/keys`                     | Clear key(s) |
| `GET`    | `/api/presets`                  | List preset summaries |
| `GET`    | `/api/presets/:id`              | Full preset with class list |
| `GET`    | `/api/projects`                 | List all projects |
| `POST`   | `/api/projects`                 | Create from file upload (multipart) |
| `POST`   | `/api/projects/json`            | Create from raw JSON body |
| `POST`   | `/api/projects/parse-file`      | Parse a GIS file, return plots preview |
| `POST`   | `/api/projects/import`          | Re-import a previously exported project `.json` |
| `GET`    | `/api/projects/:id`             | Load full project |
| `PATCH`  | `/api/projects/:id`             | Incremental update (single result, schema, name) |
| `DELETE` | `/api/projects/:id`             | Delete project |
| `GET`    | `/api/projects/:id/export`      | Download project `.json` |
| `GET`    | `/api/tiles/planet/:period/:z/:x/:y` | Planet tile proxy |
| `GET`    | `/api/tiles/esri-wayback/:release/:z/:y/:x` | ESRI Wayback tile proxy |
| `GET`    | `/api/tiles/esri-world/:z/:y/:x`   | ESRI World Imagery tile proxy |
| `POST`   | `/kml/update`                   | Update Google Earth Pro KML target |
| `GET`    | `/kml/current.kml`              | KML for Google Earth Pro NetworkLink |

---

## Keyboard Shortcuts

| Key             | Action |
|-----------------|--------|
| `1`–`9`, `0`, `q`–`p` | Select class (depending on schema) |
| `h` / `m` / `l` | Confidence: High / Medium / Low |
| `Enter`         | Submit & go to next plot |
| `←` / `→`       | Previous / Next plot |
| `n` / `p`       | Next / Previous plot (alt) |

---

## Google Earth Pro Integration

For access to historical imagery with the time slider:

1. Open Google Earth Pro
2. Open `google_earth_link.kml` (will auto-refresh from `/kml/current.kml`)
3. As you navigate plots in the web app, Google Earth Pro auto-flies to each one

---

## Tech Stack

- **Backend:** Node.js + Express, dotenv, multer, shapefile, @tmcw/togeojson, @xmldom/xmldom
- **Frontend:** Vanilla ES modules (no bundler, no framework), Leaflet 1.9
- **Storage:** Plain JSON files in `data/projects/`
- **Tile proxy:** Express `https.get` streaming proxy

---

## License

[MIT License](LICENSE) — free to use, modify, and distribute with attribution.

---

## Acknowledgments

- [EOX](https://s2maps.eu/) for Sentinel-2 cloudless mosaics
- [Planet Labs](https://www.planet.com/) for PlanetScope imagery
- [ESRI / Esri Wayback](https://livingatlas.arcgis.com/wayback/) for World Imagery archives
- [Leaflet](https://leafletjs.com/) for the mapping library
- Class-schema sources cited in [docs/SCHEMAS.md](docs/SCHEMAS.md)
- Inspired by [Collect Earth Online](https://collect.earth/) by FAO / SERVIR

---

## Developers

- **Xiao Tan** — [@tanxiaoo](https://github.com/tanxiaoo) · `xiaotan.scu@gmail.com`
- **Ammar** — [@Black-Lights](https://github.com/Black-Lights)

Politecnico di Milano · 2025
