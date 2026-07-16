# Changelog

All notable changes to earth-label are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added
- **Grid / Cells assessment mode** (`assessmentMode: "grid"`): a third per-project mode alongside Point and Pixel. The UA square (the target pixel footprint, e.g. 10 m for Sentinel-2) is divided into a configurable cell grid (2×2 / 3×3 / 4×4 / 5×5, default 3×3) and each **cell** is classified by its dominant cover — instead of labelling single sub-points that can sit on the pixel boundary. Cells aggregate to a plot-level class with the existing majority/threshold rule. (`public/js/state.js`, `public/js/map.js`, `public/js/app.js`, `public/index.html`, `server/routes/projects.js`)
- **Grid mode — optional inner box (buffer)** (`gridInnerSizeM`, default 0 = full pixel): cells tile the full UA square by default so the class percentages correspond exactly to the pixel area; optionally the cell grid can be drawn inside a smaller centered box (e.g. 9 m inside a 10 m pixel) to keep a buffer from the pixel edges against imagery/raster misalignment. (`public/js/map.js`, `public/js/app.js`, `public/index.html`)
- **Grid mode — cell map interaction**: cells render as clickable rectangles on both map panes (white grid lines = unclassified, translucent class colour = classified, orange = selected); classification auto-advances cell-by-cell exactly like sub-points, with the same progress dots, keyboard shortcuts and plot summary. (`public/js/map.js`, `public/js/app.js`)
- **Grid mode — export with density %**: CSV adds `cell_grid`, `cell_coverage_m`, `cells_json`, per-cell columns `cell_0`…`cell_N-1`, `cell_total`, `cell_dominant_count`, `cell_dominant_pct` and `cell_class_pct_json` — the per-class cover percentage (0–100%) of the pixel, e.g. impervious density for validation. GeoJSON carries the same properties (breakdown embedded as `cell_class_pct`). (`public/js/export.js`)
- **Grid mode — GEP KML sync**: in grid mode `/kml/current.kml` renders one semi-transparent colour-coded polygon per cell (orange outline = selected) inside the UA square, mirroring the web UI. (`server/routes/kml.js`, `public/js/app.js`)
- **Per-result assessment metadata**: every submitted result now stores the mode and grid geometry it was assessed with (`assessmentMode`, `uaSizeM`, `subPointGrid` / `cellGrid` + `cellCoverageM`), so exports stay truthful after settings changes. (`public/js/app.js`)
- **Mixed-mode exports**: CSV/GeoJSON now emit `assessment_mode` per row (from the stored result) and include both the pixel and grid column blocks when a project contains results from both modes — each row filled from its own stored data instead of the current project setting. Per-unit column counts cover the largest stored result so no classified unit is dropped. (`public/js/export.js`)

### Fixed
- Changing the assessment mode or grid geometry mid-project no longer lets stale in-progress sub-point/cell labels be submitted under the new geometry (out-of-range indices, wrong density denominators): unsubmitted unit labels are reset on geometry changes, stored unit labels are restored for display/re-classification only when the result's stored geometry matches the current settings, and the header count, submit gate and aggregation all consider only units of the current geometry — eliminating both the enabled-but-dead Submit button and the reverse case where a completed plot from a larger old geometry could be silently resubmitted as the new one. (`public/js/app.js`, `public/index.html`)
- Exports of a project created by re-importing a previous export no longer let the stale imported columns (carried in plot meta) shadow the freshly computed values: computed properties win in GeoJSON, and colliding meta columns are dropped from CSV. Per-unit `sp_N`/`cell_N` column counts now derive from the highest stored unit index, so sparse legacy results keep all their units. (`public/js/export.js`)
- User text (class labels, plot ids) is now XML-escaped in the GEP KML sync — a `&` or `<` in a class label previously made Google Earth Pro reject the whole live overlay. (`server/routes/kml.js`)

---

## [2.2.0] - 2026-05-18

### Added
- **Export — per-sub-point class columns** (`sp_0` … `sp_N-1`): one CSV column per grid position containing the class label assigned to that sub-point (9 cols for 3×3, 25 for 5×5). Human-readable without parsing `sub_points_json`. (`public/js/export.js`)
- **Export — sub-point agreement stats**: `sub_point_total`, `sub_point_dominant_count`, `sub_point_agreement_pct` added to both CSV and GeoJSON — makes majority-vote confidence explicit (e.g. 7/9 = 77.8%). (`public/js/export.js`)
- **Image source + date logging**: on submit, the active basemap and its selected year/date are captured automatically (`image_source`, `image_date`) and stored in the result. Exported as two new columns in CSV and GeoJSON. (`public/js/app.js`, `public/js/export.js`)
- **GEP toggle button** in toolbar: marks that Google Earth Pro was used as the reference. A year input appears so the user can record the year from GEP's time slider. Source saved as `"Google Earth Pro"` with the typed year (or blank). (`public/js/app.js`, `public/index.html`)
- **Image source indicator**: live text label above the Submit button showing which basemap and year will be recorded (e.g. `Planet · 2024-06`). Updates on every basemap switch, year change, and plot navigation. (`public/js/app.js`, `public/index.html`)
- **GEP pixel-mode KML sync**: in pixel mode the `/kml/current.kml` response now includes a UA square polygon outline and one colour-coded placemark per sub-point (orange = selected, class colour = classified, grey = unclassified). Updates on every sub-point classification and selection. (`server/routes/kml.js`, `public/js/api.js`, `public/js/app.js`)
- **Per-point time tracking**: a MM:SS live timer in the classify panel. Starts automatically on each plot navigation, resets on next plot. Pause/Resume (⏸/▶) button excludes idle time. `time_spent_s` (integer seconds) stored in result and exported in CSV/GeoJSON. (`public/js/app.js`, `public/js/state.js`, `public/index.html`, `public/js/export.js`)
- **NDVI growing season band**: a **Season** toggle button in the NDVI panel header overlays a subtle green shaded band over the growing season months (Apr–Sep) on the chart. Off by default; state persists in `localStorage`. (`public/js/ndvi-panel.js`, `public/css/app.css`, `public/index.html`)
- **Sentinel Hub / CDSE setup guide**: step-by-step instructions for obtaining OAuth credentials and enabling the NDVI panel added to `README.md` Quick Start and `docs/USER_GUIDE.md`. (`README.md`, `docs/USER_GUIDE.md`)

### Fixed
- UA columns (`ua_size_m`, `sub_point_grid`, `sub_points_json`, `sub_point_total`, `sub_point_dominant_count`, `sub_point_agreement_pct`, `sp_N`) no longer appear as headers in point-mode CSV exports. (`public/js/export.js`)
- GEP zoom slider and auto-advance broken — restored `<LookAt>` inside `<Document>` which `<flyToView>1</flyToView>` in `google_earth_link.kml` uses for camera positioning on every NetworkLink poll. (`server/routes/kml.js`)
- Timer continued running when the user returned to the project list; now stops and resets to `0:00`. (`public/js/app.js`)
- Timer auto-resumes when the user classifies while paused; a brief green "▶ resumed" notification appears. (`public/js/app.js`, `public/index.html`)
- Sub-points remaining count in the Submit button now decrements after every classification (was frozen at the initial total). (`public/js/app.js`)
- Season button active state not visible — inline `style` attribute was overriding the CSS `.active` rule; moved all styling to CSS. (`public/index.html`, `public/css/app.css`)
- Sub-point circle fill colours not updating after re-classification. (`public/js/app.js`)
- Submit button unresponsive on the last unclassified plot. (`public/js/app.js`)
- Reference label falling back incorrectly when `ref_label` was an empty string. (`public/js/app.js`)

### Docs
- UA pixel-mode workflow added to `docs/USER_GUIDE.md`
- Sub-point grid + aggregation rules added to `docs/GIS_FORMATS.md`
- Sentinel Hub credentials setup guide added to `README.md` and `docs/USER_GUIDE.md`
- `CHANGELOG.md` added covering full project history v1.0.0 → v2.2.0

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
