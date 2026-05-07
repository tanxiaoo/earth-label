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

Only the **Planet** layer needs an API key. Esri (World Imagery + Wayback) is public.

1. Click the **⚙** icon in the top-left sidebar
2. Paste your **Planet API key** ([sign up](https://www.planet.com/account/))
3. Click **Save**

The key is stored in `.env` on the server (your local machine) and proxied through the backend. It never reaches the browser. Click the **✕** next to the field to clear it.

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
- Year selectors appear next to ESRI (Wayback year-end snapshots 2018–2025) / Sentinel-2 / Planet
- **← Prev / Next →** plot navigation
- **🌍 Google Earth** — open the current plot in Google Earth Web (one-shot, opens a new tab)
- **Zoom slider** (next to the GE button) — drag to set the camera distance (50–5000 m) for both Google Earth Web and the live Google Earth Pro NetworkLink. Persists across sessions.

### Right panel — Classification
- **Reference: …** — shows the original class from the input file (color-coded if it matches the current schema). Once you've classified the plot, a second line **Your label: …** appears with your chosen class.
- **Class buttons** — one per class in the current schema; keyboard shortcut shown on the right
- **Confidence** — High / Medium / Low
- **Notes** — optional free-text
- **Submit & Next →** — saves and auto-advances to the next pending plot (`Enter` or `Space`)
- **↓ CSV / ↓ GeoJSON** — export results in either format. Re-classifying a previous plot is reflected in the next export.

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
- **Load preset** — replace the current schema with any built-in or user preset
- **↑ Import CSV** — load a schema from a CSV with `code,label,color,key` columns
- **↓ Export CSV** — download the current schema
- **★ Save as Preset** — prompts for a name and saves the current schema as a reusable preset (stored in `data/user_presets.json`). Appears in the preset selector for new projects and in the editor's **Load preset** dropdown.
- **Save Schema** — persist to the current project

The schema is saved on the server in the project file. Existing classifications are preserved (they reference the class code, not the position).

---

## 8. Google Earth Integration

There are two independent options.

### 8a. Google Earth Web (one-shot)
Click **🌍 Google Earth** in the toolbar. The current plot opens in a new tab. Each click is independent — the next plot does not auto-open another tab.

The toolbar **zoom slider** sets the camera distance embedded in the URL (approximate; GE Web snaps to its own zoom levels — round numbers like 200, 500, 1000 m work best).

### 8b. Google Earth Pro (live sync, time slider)
For access to historical imagery with the time slider:

1. Open Google Earth Pro
2. Open `google_earth_link.kml` (in the project folder) — Google Earth Pro adds a NetworkLink that auto-refreshes every second from `http://localhost:3000/kml/current.kml`
3. As you navigate plots, Google Earth Pro auto-flies to each one
4. Drag the toolbar **zoom slider** (50–5000 m) — Google Earth Pro picks up the new camera distance on the next poll (within ~1 s)
5. Use Google Earth Pro's time slider to compare imagery dates

---

## 9. Exporting Results

Three buttons in the right panel:

| Button         | Output |
|----------------|--------|
| **↓ CSV**      | Flat CSV with `PLOTID, LAT, LON, ref_code, ref_label, class_code, class_label, confidence, notes`. UTF-8 BOM prepended so Excel handles non-ASCII names. |
| **↓ GeoJSON**  | FeatureCollection with original geometry preserved (point or polygon) and snake-case canonical properties (`plot_id, lat, lon, ref_code, ref_label, class_code, class_label, confidence, notes, project_name, saved_at`) plus any unknown columns from the upload |
| **↓** (sidebar) | Full project as `.json` — includes plots, results, schema. Re-importable. |

Both CSV and GeoJSON read from live in-memory state, so re-classifying a previous plot is reflected on the **next** download immediately.

---

## 10. Keyboard Shortcuts

| Key                      | Action |
|--------------------------|--------|
| `1` `2` `3` … `0`        | Select class (mapped per schema) |
| `q` `w` `e` … `p`        | Select class (additional, used by larger schemas) |
| `h` / `m` / `l`          | Confidence: High / Medium / Low |
| `Enter` or `Space`       | Submit current classification & next plot |
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
