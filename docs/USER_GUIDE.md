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

Two optional integrations require credentials. Both are stored in `.env` on your local machine and proxied through the backend — keys never reach the browser.

### Planet (PlanetScope monthly imagery)

1. Click the **⚙** icon in the top-left sidebar
2. Paste your **Planet API key** ([sign up at planet.com/account](https://www.planet.com/account/))
3. Click **Save**

> The server auto-detects legacy `.env` files and migrates them to `KEY=VALUE` format automatically.

### Sentinel Hub (NDVI time-series panel)

The NDVI panel uses the **Copernicus Data Space Ecosystem (CDSE)** Sentinel Hub Statistical API to fetch monthly Sentinel-2 NDVI values. It is **free for research and academic use**.

**Step 1 — Create a CDSE account**

Go to [dataspace.copernicus.eu](https://dataspace.copernicus.eu) and click **Register**. Use your university or institutional email. Confirm the email and log in.

**Step 2 — Create an OAuth client**

1. Click your username (top-right) → **User Settings**
2. In the left sidebar click **OAuth clients**
3. Click **+ Create new**
4. Give the client any name (e.g. `earth-label`) and click **Create**
5. You will see a **Client ID** and a **Client Secret**

> ⚠ Copy the Client Secret immediately — it is shown only once. If you lose it, delete the client and create a new one.

**Step 3 — Add credentials to EarthLabel**

1. Click **⚙ Settings** in the top-left sidebar
2. Scroll to the **Sentinel Hub** section
3. Paste the **Client ID** and **Client Secret**
4. Click **Save** — both are written to `.env` on the server

Once saved, open the NDVI panel via the **NDVI** toolbar button. The first fetch for each plot takes ~2–3 seconds; results are cached per project so subsequent views are instant.

**Free tier limits**

| Quota | Amount |
|-------|--------|
| Processing units / month | ~30,000 (free tier) |
| Cost per NDVI fetch (one point, one year) | ~1–2 units |
| Effective fetches / month | ~15,000–30,000 |

This is more than sufficient for a thesis-scale dataset (hundreds of plots × a few years).

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

### Assessment Mode

Choose how each plot entry will be classified. This is set at project creation and can be changed at any time via **⚙ UA** in the sidebar.

| Mode | When to use |
|------|-------------|
| **Point** | Your dataset is a set of geographic sample points. Each point gets one classification with a single click. No area boundary is shown on the map. |
| **Pixel / Plot (CEO)** | Your dataset is pixel centres from a map product (e.g. Landsat CDL at 30 m, Sentinel-2 at 10 m). A Unit of Assessment (UA) square matching the pixel footprint is shown; a sub-point grid inside it is classified point-by-point; the sub-point labels are aggregated to a single plot class. |

**Pixel / Plot settings** (only shown when Pixel mode is selected):

| Setting | Options | Description |
|---------|---------|-------------|
| **UA Size** | 10 m / 20 m / 30 m / 50 m / custom | Side length of the UA square in metres. Use 10 m for Sentinel-2, 30 m for Landsat / CDL. |
| **Sub-point Grid** | 3×3 (9 pts) · 5×5 (25 pts) | Number of sample points placed uniformly inside the UA square. |
| **Aggregation Rule** | Majority · Threshold % | How sub-point labels are combined into one plot label. *Majority*: the class with the most points wins. *Threshold*: a class must reach the set percentage to win, otherwise majority is used. |

All settings are saved with the project and can be edited without losing existing results via **⚙ UA** in the sidebar.

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
- **Annotations** — per-project custom fields. By default a single text field named "Notes"; click the **✏** next to "Annotations" to rename it, change its type, or add more fields (see section 7b)
- **Submit & Next →** — saves and auto-advances to the next pending plot (`Enter` or `Space`)
- **↓ CSV / ↓ GeoJSON** — export results in either format. Re-classifying a previous plot is reflected in the next export.

---

## 5. Classifying Plots

### Point Mode

1. Click any plot in the left sidebar (or use **Next →**) to fly the map to it
2. A blue dot marks the sample point
3. If you imported polygons the outline shows in cyan
4. Examine the imagery (switch basemaps or use split view to compare)
5. Click a class button or press its keyboard shortcut
6. Set confidence: `h` / `m` / `l`
7. Fill in any annotation fields
8. **Enter** or click **Submit & Next →**

### Pixel / Plot Mode (CEO)

1. Navigate to a plot — the dashed orange square (the **UA**) appears on the map, sized exactly to the configured pixel footprint. A small label (e.g. `30 m`) shows below the square.
2. Sub-point circles fill the UA square: **black dot** = not yet classified; **coloured dot** = classified with that class colour; **orange dot** = currently active.
3. The right panel header shows **Sub-point X of N** and a row of coloured progress dots.
4. Click a sub-point circle on the map to select it, or the app auto-selects the next unclassified one.
5. Press a class keyboard shortcut or click a class button — the selected sub-point is instantly classified, its circle fills with the class colour, and the next sub-point in index order is selected automatically.
6. Repeat until all sub-points are done. The header switches to **Plot Summary** showing the aggregated class.
7. To change an already classified point, click its circle on the map or click its dot in the summary row, then choose the new class. If nothing is selected and you click a class, the app applies it to sub-point 0.
8. Set confidence and fill annotation fields for the plot as a whole.
9. Click **Submit Plot & Next →** (or **Enter**) to save and advance.

The **Reference** badge shows the map-product label for this pixel. If your CSV uses `ref_code` / `ref_label` columns they are used directly; columns named `cdl_label_code` / `cdl_label_name` are also recognised as a fallback so USDA CDL sample files work without renaming.

> **Changing UA settings mid-project** — use **⚙ UA** in the sidebar. Changes apply to all new navigations; existing classified plots are unaffected.

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

## 7b. Editing Annotation Fields

Each project has its own **annotation fields** — the per-plot inputs that appear below "Confidence" in the right panel. By default a project has one field: a free-text "Notes" textarea. You can rename it, change its type, or add more fields.

Click the **✏** icon next to the "Annotations" header.

In the editor:
- **Add Field** — append a new row
- For each field, edit:
  - **Key** — the column name used in the CSV / GeoJSON export. Must be lowercase snake_case (letters, digits, underscore; start with a letter; max 31 chars). Must be unique within the project and must not collide with built-in columns (`PLOTID, LAT, LON, ref_code, ref_label, class_code, class_label, confidence`) or with a column from your uploaded data file
  - **Label** — what the user sees in the right panel
  - **Type** — `Text` (free-form textarea) or `Yes / No` (two-button toggle, stored as `yes`, `no`, or empty)
- **✕** — delete a row (with confirmation if the field has stored values)
- **Save Fields** — persist to the project

**On renaming or deleting fields with stored data:** existing values are NOT migrated. The values stay in the project JSON on disk (recoverable by hand) but no longer appear in the UI or in exports. The editor warns you before letting you save such a change.

Each field appears as one column in the CSV export (in the order shown in the editor) and as one property per feature in the GeoJSON export.

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
| **↓ CSV**      | Flat CSV with the eight fixed columns `PLOTID, LAT, LON, ref_code, ref_label, class_code, class_label, confidence`, followed by one column per annotation field (default: `notes`; see section 7b), followed by any unknown columns from your input upload. UTF-8 BOM prepended so Excel handles non-ASCII names. |
| **↓ GeoJSON**  | FeatureCollection with original geometry preserved (point or polygon) and snake-case canonical properties (`plot_id, lat, lon, ref_code, ref_label, class_code, class_label, confidence`), one property per annotation field, plus `project_name, saved_at`, plus any unknown columns from the upload |
| **↓** (sidebar) | Full project as `.json` — includes plots, results, schema, annotation-field definitions. Re-importable. |

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
