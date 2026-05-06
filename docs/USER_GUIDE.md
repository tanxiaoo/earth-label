# User Guide

End-user walkthrough for EarthLabel — from first launch to exporting validated results.

---

## 1. First Launch

Start the server:

```bash
cd earth-label
npm install     # first time only
npm start
```

Open <http://localhost:3000>. On first launch you'll see the welcome screen with three options:

- **Create New Project** — Start fresh with a CSV/GIS file
- **Open Project File** — Re-import a previously exported project `.json`
- **Skip — Load Demo Data** — 10 sample plots in Africa with the MOLCA 10-class schema

---

## 2. Setting API Keys

Some basemaps need API keys.

1. Click the **⚙** icon in the top-left sidebar
2. Paste your key(s):
   - **Planet API key** — for PlanetScope monthly mosaics ([sign up](https://www.planet.com/account/))
   - **ESRI / ArcGIS key** — optional, for authenticated ArcGIS services
3. Click **Save**

Keys are stored in `.env` on the server (your local machine) and proxied through the backend. They never reach the browser. Click the **✕** next to a field to clear that key.

> The server auto-detects legacy `.env` files (bare values under `# Planet` / `# Esri` comments) and migrates them to proper `KEY=VALUE` format on first read.

---

## 3. Creating a Project

Click **+ New** in the sidebar.

### Project Name
Free text — used for the file name on disk and in CSV/GeoJSON exports.

### Plot File
Drag-and-drop or click to upload. Supported:

| Format    | Extensions           |
|-----------|----------------------|
| CSV       | `.csv`               |
| GeoJSON   | `.geojson`, `.json`  |
| KML       | `.kml`               |
| KMZ       | `.kmz`               |
| Shapefile | `.zip` (containing `.shp`+`.dbf`+`.shx`) |

See [GIS_FORMATS.md](GIS_FORMATS.md) for field-name conventions.

### Classification Schema
Pick one of the 10 built-in presets, or **Custom (start blank)** to build your own. The schema is saved with the project — different projects can use different schemas.

After creation, you can edit the schema at any time via the **✏** icon in the right panel.

---

## 4. The Interface

```
┌──────────┬──────────────────────────────────┬──────────┐
│          │   Map toolbar                    │          │
│ Projects │ ────────────────────────────────│ Classify │
│   list   │                                  │  panel   │
│          │                                  │          │
│  or      │       Map (single or split)      │ Classes  │
│          │                                  │          │
│ Plot     │                                  │ Confid-  │
│  list    │                                  │  ence    │
│          │                                  │          │
│          │                                  │ Submit   │
└──────────┴──────────────────────────────────┴──────────┘
```

### Left sidebar — Project list view
- **Recent / A–Z** sort buttons
- **+ New** to create a project
- **📂** to import a previously exported project `.json`
- Click any project to open it

### Left sidebar — Plot list view (when a project is open)
- Project name + progress bar
- **All / Pending / Done** filters
- Each plot row shows: status dot, plot ID, lat/lon, reference-class badge
- **↓** export project `.json` · **🗑** delete project

### Map toolbar
- **◫ Split** — toggle dual-map mode
- Basemap buttons: Google · ESRI · Bing · Sentinel-2 · Planet
- Year selectors appear next to ESRI / Sentinel-2 / Planet
- **← Prev / Next →** plot navigation
- **🌍 GE Pro** — toggle Google Earth Pro auto-fly

### Right panel — Classification
- **Reference: …** — shows the original class from the input file (color-coded if it matches the current schema)
- **Class buttons** — one per class in the current schema; keyboard shortcut shown on the right
- **Confidence** — High / Medium / Low
- **Notes** — optional free-text
- **Submit & Next →** — saves and auto-advances to the next pending plot
- **↓ CSV / ↓ GeoJSON** — export results in either format

---

## 5. Classifying Plots

The standard workflow:

1. Click any plot in the left sidebar (or use **Next →**) to fly the map to it
2. The dashed orange square shows the 70m reference area
3. If you imported polygons, the polygon outline shows in cyan
4. Examine the imagery (switch basemaps or use split view to compare)
5. Click a class button or press its keyboard shortcut
6. Set confidence: `h` / `m` / `l`
7. Optional notes
8. **Enter** or click **Submit & Next →**

The plot is marked **Done** in the list and the next pending plot loads automatically.

---

## 6. Comparing Imagery (Split View)

Click **◫ Split** in the toolbar. The map splits into two synced panes — pan or zoom on one and the other follows.

Each pane has its own basemap selector in its top-right corner. Common workflow: Google high-res on the left, Sentinel-2 of a specific year on the right, to spot temporal changes.

---

## 7. Editing the Class Schema

Click the **✏** icon in the right panel header.

In the editor:
- **Add Class** — create a new row
- For each class, edit color (color-picker), code (numeric ID), label, and key shortcut (single character)
- **Load preset** — replace the current schema with any built-in preset
- **↑ Import CSV** — load a schema from a CSV with `code,label,color,key` columns
- **↓ Export CSV** — download the current schema
- **Save Schema** — persist to the project

The schema is saved on the server in the project file. Existing classifications are preserved (they reference the class code, not the position).

---

## 8. Google Earth Pro Sync

For access to historical imagery with the time slider:

1. Open Google Earth Pro
2. Open `google_earth_link.kml` (in the project folder) — Google Earth Pro adds a NetworkLink that auto-refreshes every second from `http://localhost:3000/kml/current.kml`
3. Click the **🌍 GE Pro** button in the toolbar to activate the sync
4. As you navigate plots, Google Earth Pro auto-flies to each one
5. Use Google Earth Pro's time slider to compare imagery dates

---

## 9. Exporting Results

Three buttons in the right panel:

| Button         | Output |
|----------------|--------|
| **↓ CSV**      | Flat CSV with `project_name, PLOTID, LAT, LON, ref_code, ref_label, classified_code, classified_label, confidence, notes` |
| **↓ GeoJSON**  | FeatureCollection with original geometry preserved (point or polygon) and all results in `properties` |
| **↓** (sidebar) | Full project as `.json` — includes plots, results, schema. Re-importable. |

---

## 10. Keyboard Shortcuts

| Key                      | Action |
|--------------------------|--------|
| `1` `2` `3` … `0`        | Select class (mapped per schema) |
| `q` `w` `e` … `p`        | Select class (additional, used by larger schemas) |
| `h` / `m` / `l`          | Confidence: High / Medium / Low |
| `Enter`                  | Submit current classification & next plot |
| `→` or `n`               | Next plot |
| `←` or `p`               | Previous plot |

Shortcuts are disabled while typing in input fields (notes, search, etc.).

---

## 11. Multi-Project Workflows

- Each project is one `.json` file in `data/projects/`
- Switch between projects: click **← Projects** at the top of the plot list, then click another project
- Last-opened project is restored automatically on next launch
- Share a project: click **↓** (sidebar) to download the JSON, send it; the recipient clicks **📂** to import

---

## 12. Troubleshooting

**Settings show "NOT SET" but my `.env` has keys**
The server auto-migrates legacy formats on first read. Restart the server (`Ctrl+C` and `npm start`) — your `.env` will be reformatted and keys detected.

**Planet tiles are broken / show grey**
Make sure your Planet API key is set in **⚙ Settings**. The browser-side console will show 401 responses from `/api/tiles/planet/...` if the key is missing.

**Shapefile upload fails**
Make sure you zip together at least the `.shp`, `.dbf`, and `.shx` files. The `.prj` is optional but recommended for non-WGS84 data (currently EarthLabel assumes WGS84).

**Polygons aren't showing on the map**
Polygons are drawn in the left map only. Switch off split view, or check that the geometry was preserved in the input file.

**Server won't start: port already in use**
Set the `PORT` environment variable before `npm start`:

```bash
PORT=4000 npm start
```
