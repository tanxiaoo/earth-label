# Changelog

All notable changes to earth-label are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added
- **Export — per-sub-point class columns** (`sp_0` … `sp_N-1`): one CSV column per grid position containing the class label assigned to that sub-point (9 columns for 3×3, 25 for 5×5). Human-readable without parsing `sub_points_json`. (`public/js/export.js`)
- **Export — sub-point agreement stats**: three new columns in both CSV and GeoJSON — `sub_point_total`, `sub_point_dominant_count`, `sub_point_agreement_pct` — making the majority-vote confidence explicit (e.g. 7/9 = 77.8%). (`public/js/export.js`)

### Fixed
- Sub-point circle fill colours not updating after re-classification
- Submit button unresponsive on the last unclassified plot
- Reference label falling back incorrectly when `ref_label` was an empty string

### Docs
- UA pixel-mode workflow added to `docs/USER_GUIDE.md`
- Sub-point grid + aggregation rules added to `docs/GIS_FORMATS.md`

---

## [2.1.0] - 2026-05-17

### Added
- **CEO-compliant pixel / plot assessment mode**: Unit of Assessment (UA) square sized correctly in metres (latitude-corrected), configurable 3×3 or 5×5 sub-point grid, each sub-point classified individually. (`public/js/map.js`, `public/js/app.js`)
- **Aggregation rules**: majority (most frequent class wins) and threshold (class must reach a configurable fraction of sub-points). Stored per project and editable at any time via the ⚙ UA button. (`public/js/app.js`)
- **Sub-point persistence**: all individual sub-point results stored in `results[plotId].subPoints[]` in the project JSON. (`server/routes/projects.js`)
- **UA export columns**: `assessment_mode`, `ua_size_m`, `sub_point_grid`, `sub_points_json` added to CSV; `sub_points` array added to GeoJSON. (`public/js/export.js`)
- **Project Settings modal** (⚙ UA button in sidebar): change UA settings for an existing project at any time. (`public/js/app.js`, `public/index.html`)
- **NDVI panel**: draggable, resizable floating panel showing a Chart.js monthly Sentinel-2 NDVI time series via the CDSE Sentinel Hub Statistical API. Includes a per-class interpretation guide (editable NDVI range + seasonal pattern), reference-range band on the chart, year selector, and per-plot result cache. (`public/js/ndvi-panel.js`, `server/routes/ndvi.js`)
- **Configurable annotation fields**: per-project text and yes/no fields replace the single hardcoded `notes` textarea. Fields are defined in a modal, validated for reserved names, and flow through CSV/GeoJSON exports. (`public/js/annotation-fields.js`, `server/routes/projects.js`)
- **Sentinel Hub credentials UI**: client ID and secret stored server-side via the existing key management endpoint; NDVI fetch disabled gracefully after a credential error. (`server/lib/env-manager.js`, `server/routes/keys.js`)
- `state.assessmentMode`, `plotSizeM`, `subPointGrid`, `aggregationRule`, `aggregationThreshold`, `selectedSubPointIdx`, `subPointResults` added to central state. (`public/js/state.js`)

### Changed
- `metersToDeg()` helper added to `map.js` for latitude-correct metre → degree conversion used by the UA square and sub-point grid.
- Export column order locked: fixed cols → annotation fields → meta (original upload columns). (`public/js/export.js`)
- Class presets seeded with `ndviRange` and `seasonalPattern` hints used by the NDVI guide. (`server/lib/class-presets.js`)
- `gis-parser.js`: reference-column matching tightened to `ref_code` / `ref_label` (case-insensitive) only; all other columns land in `meta` for round-trip preservation.

---

## [2.0.1] - 2026-05-07

### Fixed
- ESRI Wayback tiles failing — proxy now follows 301 redirects and the API token is dropped from upstream URLs. (`server/routes/tiles.js`)
- Dropdown option text invisible in dark theme (year/month pickers). (`public/index.html`)
- Project name mojibake on Windows — heuristic UTF-8 repair for multer latin1 decoding. (`server/routes/projects.js`)

### Added
- Wayback year selector expanded to full 2018–2025 range, mapped to official ESRI release IDs. (`public/js/map.js`, `public/index.html`)
- **Save as Preset** button in the class editor: persists custom schemas to `data/user_presets.json`; backend routes `POST /api/presets` and `DELETE /api/presets/:id` added. (`public/js/classes.js`, `server/routes/presets.js`)
- **Draggable GE zoom slider** (50–5000 m, default 1000 m) in toolbar: drives both GE Pro KML `<LookAt><range>` and the GE Web button URL. Persists in `localStorage`. (`server/routes/kml.js`, `public/js/app.js`, `public/index.html`)
- Space bar now submits and advances to next plot (alongside Enter). (`public/js/app.js`)
- Plot list: Pending/All views show the reference label; Done view shows the user's classification. (`public/js/app.js`)
- `google_earth_link.kml` fixed — URL corrected from dead port 8765 to `localhost:3000/kml/current.kml`. (`google_earth_link.kml`)

### Changed
- CSV export: identity columns uppercased (`PLOTID`, `LAT`, `LON`); `project_name` and `saved_at` removed; UTF-8 BOM prepended for Excel compatibility. (`public/js/export.js`)
- GeoJSON properties normalised to snake_case; original `meta` columns preserved alongside. (`public/js/export.js`)
- GE Pro toggle replaced with a one-shot "🌍 Google Earth" button (opens GE Web in a new tab). (`public/js/app.js`, `public/index.html`)
- ESRI key field removed from the Settings modal (Wayback is public). (`public/index.html`)

### Removed
- `molca_validator.html` — legacy single-file validator superseded by v2. (`molca_validator.html`)
- `server.js` — orphan port-8765 KML server, now merged into the main Express app. (`server.js`)

### Docs
- README, `docs/USER_GUIDE.md`, `docs/DEVELOPER.md`, `docs/GIS_FORMATS.md` updated for v2 schema and new features.
- 2026 added to Planet year selector; year references bumped throughout.

---

## [2.0.0] - 2026-05-06

Complete rewrite from a standalone HTML file to a full client–server application.

### Added
- **Express server** (`server/index.js`) on port 3000 — replaces the standalone `server.js`.
- **API key management**: `POST /api/keys` writes to `.env` server-side; keys never sent to the browser. Planet tiles proxied via `/api/tiles/planet`. (`server/routes/keys.js`, `server/routes/tiles.js`)
- **Project persistence**: projects stored as JSON files in `data/projects/`; full CRUD + export/import of `.json` project files. (`server/routes/projects.js`)
- **Dynamic class schema**: per-project legends with colour picker, keyboard shortcut, add/edit/delete. Schema stored in project file. (`public/js/classes.js`)
- **10 built-in LULC presets**: Binary, MOLCA, CORINE L1/L2, IGBP/MODIS, ESA CCI, NLCD 2021, IPCC, Anderson/USGS, FROM-GLC. (`server/lib/class-presets.js`)
- **GIS import**: CSV, GeoJSON, KML, KMZ, Shapefile (ZIP). Polygons: centroid for navigation, geometry stored and drawn on map. (`server/lib/gis-parser.js`)
- **Export**: CSV and GeoJSON (including polygon geometry if input was polygons). (`public/js/export.js`)
- **Google Earth Pro KML sync** merged into main server at `/kml/`. (`server/routes/kml.js`)
- **Modular ES frontend**: `api.js`, `state.js`, `map.js`, `classes.js`, `export.js`, `app.js`. (`public/js/`)
- Drag-and-drop file zone in the create-project modal. (`public/index.html`)

### Changed
- Application entry point moved from `molca_validator.html` to `public/index.html` served by Express.
- All project data moved from browser IndexedDB to server-side JSON files.

---

## [1.1.0] - 2026-05-05

### Added
- ESRI World Imagery and Bing Maps basemap layers. (`public/js/map.js`)

### Changed
- Default Google Earth Pro zoom level adjusted for field-scale interpretation.

---

## [1.0.0] - 2026-05-04

Initial release — single-file satellite image labelling tool (`molca_validator.html`) with Leaflet map, Google/Sentinel-2 basemaps, CSV import/export, and Google Earth Pro KML auto-follow.
