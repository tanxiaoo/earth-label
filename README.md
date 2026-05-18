# EarthLabel

**Satellite Image Interpretation Platform — v2**

A self-hosted web app for satellite image interpretation and land-cover validation. Built as a lighter, faster alternative to Collect Earth Online with multi-source high-resolution imagery, dynamic class schemas, and GIS file support.

> **v2 is a full rewrite.** A proper Express + ES-modules web app with a backend, persistent project files on disk, and server-side API key management.

---

## Features

- **Multi-source basemaps** — Google Satellite, ESRI World Imagery (latest + Wayback year-end snapshots 2018–2025, no API key required), Bing, Sentinel-2 cloudless (2018–2024), Planet PlanetScope (monthly mosaics 2016–2026)
- **Dual map / split view** — Compare two basemaps side-by-side with synced pan/zoom
- **Dynamic classification schemas** — 10 built-in real-world LULC presets (MOLCA, CORINE, IGBP/MODIS, ESA CCI, NLCD, IPCC, Anderson/USGS, FROM-GLC, Binary, Custom). Each project carries its own schema; edit, add, delete classes with color picker and keyboard shortcuts. Save any edited schema as a reusable user preset.
- **Two assessment modes (per project)** — **Point mode**: classify each sample point directly with one click — ideal for vector point datasets. **Pixel/Plot mode** (Collect Earth Online–compatible): each entry is a pixel/map centre; a correctly-sized Unit of Assessment (UA) square is drawn on the map, a configurable sub-point grid (3×3 or 5×5) is placed inside it, each sub-point is classified individually, and a majority or threshold rule aggregates the sub-point labels to a single plot-level class.
- **Configurable UA size** — UA square side length is set per project (quick buttons: 10 m / 20 m / 30 m / 50 m or any custom value). The square is computed in real metres using a latitude-correct degree conversion so it always matches the target map pixel (e.g. 30 m for Landsat/CDL, 10 m for Sentinel-2).
- **Configurable annotation fields** — Each project defines its own per-plot annotation columns: rename the default `notes` text field, or add more fields (text or yes/no binary) such as `cloud_cover`, `damage_observed`. Each field becomes its own column in CSV / property in GeoJSON exports.
- **NDVI time-series panel** — Floating, draggable Sentinel-2 monthly NDVI panel with a per-class interpretation guide. Requires Sentinel Hub credentials (stored in `.env`).
- **GIS import** — `.csv` · `.geojson` · `.kml` · `.kmz` · Shapefile (`.zip`). Points and Polygons supported; polygon centroids used for navigation, full geometry drawn on the map.
- **Server-side API key management** — Planet and Sentinel Hub keys stored in `.env` and proxied through the backend; keys never reach the browser. Esri layers are public — no key needed.
- **Project files on disk** — Each project = one JSON file in `data/projects/`. Portable, version-controllable, easy to share. Export/import any project as a `.json` file.
- **Auto-save** — Every classification result persists immediately via incremental PATCH to the backend.
- **Image source logging** — On every submit, the active basemap and selected year/date are automatically recorded (`image_source`, `image_date`). A live indicator above the Submit button shows what will be saved (e.g. `Planet · 2024-06`). Use the **📡 GEP** toggle to mark Google Earth Pro as the reference and enter the year from GEP's time slider.
- **Per-point time tracking** — A MM:SS live timer starts on each plot navigation. Pause/Resume (⏸/▶) stops the clock during interruptions. `time_spent_s` is saved with every result and exported — useful for estimating total annotation time at scale and flagging difficult plots.
- **Multiple export formats** — CSV (flat results) and GeoJSON (with original geometry preserved). Point-mode exports include only core result columns. Pixel-mode exports additionally include `ua_size_m`, `sub_point_grid`, per-sub-point class columns (`sp_0`…`sp_N-1`), `sub_point_total`, `sub_point_dominant_count`, `sub_point_agreement_pct`, and `sub_points_json`. Re-classifying a plot updates the next export immediately.
- **Google Earth integration** — One-shot **Google Earth Web** button opens the current plot in a new tab. Live **Google Earth Pro** sync via NetworkLink (`/kml/current.kml`) flies the camera to each plot on submit. In pixel mode, the KML includes the UA square polygon and colour-coded sub-point placemarks. Toolbar slider (50–5000 m) controls camera distance, persisted across sessions.
- **Keyboard shortcuts** — Rapid classification with per-class hotkeys, confidence levels (`h`/`m`/`l`), `Enter` or `Space` to submit, arrow keys to navigate.

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

### 3. Add a Planet API key (optional, for PlanetScope imagery)

Click the **⚙ Settings** icon (top-left) and paste your Planet API key. It is written to `.env` on the server — never sent back to the browser.

Esri layers (World Imagery and Wayback) are public — no API key required.

### 4. Add Sentinel Hub credentials (optional, for NDVI time-series)

The NDVI panel fetches monthly Sentinel-2 NDVI via the **Copernicus Data Space Ecosystem (CDSE)** Sentinel Hub Statistical API. It is free for research use.

1. **Register** at [dataspace.copernicus.eu](https://dataspace.copernicus.eu) (free — use your university email)
2. Log in → top-right username → **User Settings** → left sidebar **OAuth clients**
3. Click **+ Create new** → give it any name (e.g. `earth-label`) → **Create**
4. Copy the **Client ID** and **Client Secret** (the secret is shown only once)
5. In EarthLabel: **⚙ Settings** → paste both values → **Save**

Free tier: ~30,000 processing units/month — sufficient for thousands of NDVI fetches per month.

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
│       ├── state.js           ← App state (incl. UA / sub-point state)
│       ├── map.js             ← Leaflet dual-map, UA square, sub-point grid
│       ├── classes.js         ← Class editor + render
│       ├── annotation-fields.js ← Per-project annotation inputs + editor
│       ├── ndvi-panel.js      ← Floating NDVI time-series panel
│       └── export.js          ← CSV / GeoJSON / project export
└── data/                      ← Local data (gitignored)
    ├── projects/              ← Project JSON files
    └── user_presets.json      ← Schemas saved as reusable presets
```

See [docs/](docs/) for detailed guides.

---

## Documentation

- [docs/USER_GUIDE.md](docs/USER_GUIDE.md) — End-user walkthrough: creating projects, importing GIS data, classifying, keyboard shortcuts
- [docs/SCHEMAS.md](docs/SCHEMAS.md) — All 10 LULC presets with class lists, sources, and citations
- [docs/DEVELOPER.md](docs/DEVELOPER.md) — Architecture, API reference, how to add features
- [docs/GIS_FORMATS.md](docs/GIS_FORMATS.md) — Supported import formats and field-name conventions

---

## CSV Format

### Input (upload)

Your input CSV must contain `LAT` and `LON` columns. Plot ID and reference class are optional.

```csv
PLOTID,LAT,LON,ref_code,ref_label
1,0.5856,27.7400,20,Forest
2,7.5617,13.7757,5,Shrubland
```

Recognised columns on upload:

| Field                       | Accepted column names |
|-----------------------------|------------------------|
| Plot ID (optional)          | `PLOTID`, `plotid`, `ID`, `id`, `FID`, `fid`, `NAME`, `name`, `Plot_ID`, `plot_id` |
| Latitude (required)         | `LAT`, `latitude`, `y`, `Y` |
| Longitude (required)        | `LON`, `LONG`, `LONGITUDE`, `lng`, `LNG`, `x`, `X` |
| Reference code (optional)   | `ref_code` |
| Reference label (optional)  | `ref_label` |

Header matching is **exact and case-insensitive** — `ref_code` and `REF_CODE` are both recognized, but variants like `molca_class`, `molca_class_2024`, or `class_code` are not. Any column whose header is not in the table above is preserved as plot metadata and round-trips into **both CSV and GeoJSON** exports. If your CSV uses a different name for the reference column, either rename it to `ref_code` / `ref_label` before upload, or accept that it will appear as a metadata column in exports rather than as the canonical reference column.

### Output (CSV download)

**Point mode** columns (always present):

```
PLOTID, LAT, LON, ref_code, ref_label, class_code, class_label, confidence,
image_source, image_date, time_spent_s, assessment_mode,
<annotation fields…>, <meta columns…>
```

**Pixel mode** adds after `assessment_mode`:

```
ua_size_m, sub_point_grid, sub_points_json,
sub_point_total, sub_point_dominant_count, sub_point_agreement_pct,
sp_0, sp_1, … sp_N-1
```

| Column | Description |
|--------|-------------|
| `image_source` | Basemap used when classifying (e.g. `Planet`, `ESRI Wayback`, `Google Earth Pro`) |
| `image_date` | Year or year-month of the image (e.g. `2024-06`, `2022`) — blank for Google/Bing current |
| `time_spent_s` | Seconds spent classifying this plot (pause time excluded) |
| `assessment_mode` | `point` or `pixel` |
| `ua_size_m` | UA square side in metres *(pixel mode only)* |
| `sub_point_grid` | Grid config e.g. `3x3` *(pixel mode only)* |
| `sub_points_json` | Raw JSON array `[{idx,code,label},…]` *(pixel mode only)* |
| `sub_point_total` | Number of classified sub-points *(pixel mode only)* |
| `sub_point_dominant_count` | Sub-points matching the winning class *(pixel mode only)* |
| `sub_point_agreement_pct` | Agreement % for the winning class e.g. `77.8` *(pixel mode only)* |
| `sp_0` … `sp_N-1` | Class label for each grid position *(pixel mode only; 9 cols for 3×3, 25 for 5×5)* |

The columns after the UA block come from the project's **annotation fields** — by default a single text field named `notes`. Any unrecognised columns from the original upload are appended at the end, so the export is a strict superset of the input. A UTF-8 BOM is prepended so Excel renders non-ASCII names correctly.

### Output (GeoJSON download)

Each feature carries the canonical snake-case properties (`plot_id, lat, lon, ref_code, ref_label, class_code, class_label, confidence, image_source, image_date, time_spent_s, assessment_mode, project_name, saved_at`), plus `ua_size_m`, `sub_point_grid`, `sub_points`, `sub_point_total`, `sub_point_dominant_count`, `sub_point_agreement_pct` in pixel mode, one property per annotation field, and any extra columns from the original upload.

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
| `GET`    | `/api/presets`                  | List preset summaries (built-in + user) |
| `GET`    | `/api/presets/:id`              | Full preset with class list |
| `POST`   | `/api/presets`                  | Save current schema as a user preset |
| `DELETE` | `/api/presets/:id`              | Delete a user preset (built-ins are immutable) |
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
| `Enter` or `Space` | Submit & go to next plot |
| `←` / `→`       | Previous / Next plot |
| `n` / `p`       | Next / Previous plot (alt) |

---

## Google Earth Integration

Two independent ways to view a plot in Google Earth:

### Google Earth Web (one-shot, no install)
Click **🌍 Google Earth** in the toolbar. The current plot opens in a new tab. Each click is independent — navigating to the next plot does not auto-open another tab. The toolbar zoom slider sets the camera distance embedded in the URL (approximate; GE Web snaps to its own zoom levels).

### Google Earth Pro (live sync)
For access to historical imagery with the time slider:

1. Open Google Earth Pro.
2. Open `google_earth_link.kml` from the project root — it adds a NetworkLink that polls `http://localhost:3000/kml/current.kml` every second.
3. As you navigate plots in the web app, Google Earth Pro auto-flies to each one. Drag the toolbar zoom slider (50–5000 m) to change the camera distance live; GE Pro picks it up on the next poll.

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

Politecnico di Milano · 2026
