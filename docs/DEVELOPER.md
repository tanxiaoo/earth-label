# Developer Guide

Architecture, contribution patterns, and how to add features to EarthLabel.

---

## Stack

| Layer       | Choice                          | Why |
|-------------|---------------------------------|-----|
| Server      | Node.js + Express               | Light, no build step, already used for KML in v1 |
| Static      | Express `static`                | One process, no separate dev server |
| Frontend    | Vanilla ES modules              | Browser-native, no bundler, easy to read |
| Storage     | Plain JSON files                | Portable, version-controllable, no DB setup |
| GIS parsing | `shapefile`, `@tmcw/togeojson`  | Pure-JS, no GDAL install required |
| Tile proxy  | `https.get` streaming           | Zero-dep, hides API keys |

No webpack, no React, no TypeScript. Edit a file, refresh the page.

---

## Layout

```
earth-label/
├── package.json
├── .env                         (gitignored, auto-managed)
├── server/
│   ├── index.js                 main entry
│   ├── lib/
│   │   ├── env-manager.js       .env read/write + legacy-format migration
│   │   ├── class-presets.js     all 10 built-in LULC schemas
│   │   └── gis-parser.js        CSV / GeoJSON / KML / Shapefile → plot[]
│   └── routes/
│       ├── keys.js              /api/keys
│       ├── presets.js           /api/presets
│       ├── projects.js          /api/projects
│       ├── tiles.js             /api/tiles  (Planet/ESRI proxy)
│       └── kml.js               /kml        (Google Earth Pro sync)
├── public/
│   ├── index.html
│   ├── css/app.css
│   └── js/                      ES modules
│       ├── api.js               fetch() wrappers
│       ├── state.js             single mutable state object
│       ├── map.js               Leaflet dual-map, tile layers, navigation
│       ├── classes.js           class-button rendering + class editor modal
│       ├── export.js            CSV / GeoJSON / project-file export
│       └── app.js               main entry, orchestration, keyboard shortcuts
└── data/projects/               (gitignored) one .json file per project
```

---

## Boot Sequence

1. `server/index.js` loads `.env` via `dotenv`, creates `data/projects/` if missing, mounts routes, serves `public/`
2. Browser fetches `/index.html` → `<script type="module" src="/js/app.js">`
3. `app.js` calls `initMap()`, then in parallel:
   - `GET /api/presets` → cached in `state.presets`
   - `GET /api/keys/status` → updates the SET / NOT SET badges
   - `GET /api/projects` → if any exist, restore the last one from `localStorage.lastProjectId`; otherwise show the welcome overlay

---

## Frontend State

A single mutable object in `public/js/state.js`:

```js
export const state = {
  project:          null,    // full project from server, with classSchema, plots, results
  plots:            [],      // project.plots merged with current results
  currentIndex:     -1,      // index into state.plots
  selectedClass:    null,    // currently chosen class code
  selectedConfidence: null,
  currentFilter:    'all',
  projectSort:      'recent',
  isSplitMode:      false,
  leftBasemap:      'google',
  rightBasemap:     'sentinel2',
  isFirstPlotLoad:  true,
  presets:          [],     // built-in + user presets, cached from /api/presets
  geRange:          1000,   // GE Pro / GE Web camera distance, meters; persisted to localStorage
};

export function setState(updates) { Object.assign(state, updates); }
```

No reactivity layer — modules read `state` directly and call render functions when needed. This keeps the code traceable.

---

## Module Communication

To avoid circular imports:

- **`state.js`** imports nothing
- **`api.js`** imports nothing
- **`map.js`** imports `state`
- **`classes.js`** imports `state`, `api`
- **`export.js`** imports `state`, `api`
- **`app.js`** imports everything

`app.js` is the orchestrator. HTML `onclick` handlers call `app.someFn()` — at the bottom of `app.js`, all public functions are exposed on `window.app` so the inline handlers work.

---

## Project Data Model

A project file in `data/projects/<id>.json`:

```json
{
  "id": "proj_1730000000_abc12",
  "name": "Nairobi 2024",
  "created":  "2026-05-06T10:00:00.000Z",
  "lastUsed": "2026-05-06T14:32:00.000Z",
  "classSchema": [
    { "code": 20, "label": "Forest", "color": "#548235", "key": "1" },
    …
  ],
  "plots": [
    {
      "id":        "1",
      "lat":       0.5856,
      "lon":       27.7400,
      "refCode":   "20",
      "refLabel":  "Forest",
      "geometry":  null,        // or GeoJSON geometry if imported from polygon
      "meta":      { … }        // any extra columns from the input
    },
    …
  ],
  "results": {
    "1": {
      "code": 20, "label": "Forest",
      "confidence": "High", "notes": "",
      "savedAt": "2026-05-06T11:05:23.000Z"
    },
    …
  }
}
```

- `plots[]` is set once at creation and immutable thereafter
- `results{}` grows as the user classifies; keyed by `plot.id`
- `classSchema[]` can be edited at any time without breaking existing results (results reference codes)

---

## API Reference

### Keys
| Method | Path                  | Body                         | Returns |
|--------|-----------------------|------------------------------|---------|
| GET    | `/api/keys/status`    | —                            | `{planet:bool, esri:bool}` |
| POST   | `/api/keys`           | `{planet?:string, esri?:string}` | `{success:true}` |
| DELETE | `/api/keys`           | `{planet?:true, esri?:true}` | `{success:true}` |

### Presets
| Method | Path                | Body                                | Returns |
|--------|---------------------|-------------------------------------|---------|
| GET    | `/api/presets`      | —                                   | array of `{id, name, description, source, url, classCount, user}` (built-ins + user presets) |
| GET    | `/api/presets/:id`  | —                                   | full preset including `classes[]` |
| POST   | `/api/presets`      | `{name, classes[], description?}`   | `{id}` — id is prefixed `user_…` |
| DELETE | `/api/presets/:id`  | —                                   | `{success:true}` (built-ins are immutable) |

User presets are stored in `data/user_presets.json` (gitignored) and merged with the built-ins from `server/lib/class-presets.js` on every list call.

### Projects
| Method | Path                              | Body                                                   | Returns |
|--------|-----------------------------------|--------------------------------------------------------|---------|
| GET    | `/api/projects`                   | —                                                      | array of summaries |
| GET    | `/api/projects/:id`               | —                                                      | full project |
| POST   | `/api/projects`                   | `multipart` (`name`, `classSchema` JSON, `file`?)       | `{id}` |
| POST   | `/api/projects/json`              | `{name, classSchema, plots}`                           | `{id}` |
| POST   | `/api/projects/parse-file`        | `multipart` (`file`)                                   | `{plots, count}` |
| POST   | `/api/projects/import`            | `multipart` (`file`: project json)                     | `{id}` |
| PATCH  | `/api/projects/:id`               | `{plotId?, result?, classSchema?, name?, lastUsed?}`   | `{success:true}` |
| DELETE | `/api/projects/:id`               | —                                                      | `{success:true}` |
| GET    | `/api/projects/:id/export`        | —                                                      | downloads `.json` |

### Tiles (server-side proxy, hides API keys)
| Method | Path                                               |
|--------|----------------------------------------------------|
| GET    | `/api/tiles/planet/:period/:z/:x/:y`               |
| GET    | `/api/tiles/esri-wayback/:release/:z/:y/:x`        |
| GET    | `/api/tiles/esri-world/:z/:y/:x`                   |

### KML (Google Earth Pro)
| Method | Path                | Body                                  |
|--------|---------------------|---------------------------------------|
| POST   | `/kml/update`       | `{lat?, lon?, id?, label?, range?}`   |
| GET    | `/kml/current.kml`  | KML doc with current plot + LookAt range |

`range` is the camera-to-target distance in meters (`<LookAt><range>`), default 1000. The browser POSTs it on every plot navigation and on every drag of the toolbar zoom slider — slider drags can be range-only (no coords). Google Earth Pro picks up changes via the NetworkLink poll (~1 s).

---

## Adding Features

### Add a basemap
1. In `public/js/map.js`, extend `getTileLayer(name, p1, p2)` with a new branch
2. Add a button to `public/index.html` toolbar with `onclick="app.switchBasemap('myname')"`
3. Add the same button to both mini-basemap selectors (left + right pane)
4. If your tiles need an API key: add a tile-proxy route in `server/routes/tiles.js` and call it via a relative URL (e.g. `/api/tiles/myname/{z}/{x}/{y}`)

### Add a built-in classification preset
1. Edit `server/lib/class-presets.js`
2. Add a new entry with `name`, `description`, `source`, `url`, `classes`
3. Restart the server. It appears automatically in all preset dropdowns.

### Add a GIS format
1. Edit `server/lib/gis-parser.js` — add a branch to `parseGIS(buffer, filename)` based on file extension
2. Implement a parser that returns `[{id, lat, lon, refCode, refLabel, geometry, meta}, ...]`
3. Update the `accept` attribute on `#newProjectFile` in `public/index.html`
4. Update the hint in the create-project modal

### Add an export format
1. Add a function in `public/js/export.js`
2. Expose it via `window.app` in `public/js/app.js`
3. Add a button in the right panel of `public/index.html`

### Add a new state field
1. Add it with a default in `public/js/state.js`
2. Mutate via `setState({ ... })`
3. (Optional) persist across sessions by reading/writing `localStorage` in `app.js init()`

---

## Adding a Tile Proxy

Pattern in `server/routes/tiles.js`:

```js
router.get('/myservice/:z/:x/:y', (req, res) => {
  const key = readEnv().MYSERVICE_API_KEY;
  if (!key) return res.status(401).json({ error: 'Key not set' });
  const { z, x, y } = req.params;
  proxyTile(`https://my.tile.service/${z}/${x}/${y}?key=${key}`, res);
});
```

Then on the frontend, point the Leaflet tile layer at the relative URL `/api/tiles/myservice/{z}/{x}/{y}`. The browser never sees the key.

---

## Running in Dev Mode

`npm run dev` uses Node's built-in `--watch` flag — restart on file changes.

```bash
PORT=4000 npm run dev      # custom port
```

Frontend has no build step — just hard-refresh the browser (`Ctrl+Shift+R`) after editing `public/`.

---

## Debugging

### Server
- Logs to stdout
- API errors return JSON `{error: "..."}` with appropriate status codes
- `console.log()` any time

### Frontend
- Open DevTools → Console
- Network tab shows API calls; failed `/api/...` requests usually mean the server isn't running or a route is missing
- `state` is on `window` — type `app` in the console to see all exposed functions

---

## Code Style

- **Two-space indent**, single-quoted strings, semicolons
- **No comments** unless explaining a non-obvious "why"
- **No premature abstractions** — three similar lines beat a one-use helper
- **Trust internal code** — only validate at the boundary (request bodies, file uploads)
- **Vanilla JS** — no jQuery, no lodash, no framework

---

## Known Limitations

- Polygon overlay only on the left map pane (not synced to the right pane)
- Tile proxy doesn't cache — every browser request hits upstream (browsers do their own HTTP caching)
- ESRI Wayback year-end release IDs (2018→23448, 2019→4756, 2020→29260, 2021→26120, 2022→45134, 2023→56102, 2024→16453, 2025→13192) are hardcoded in `public/js/map.js`. To add a new year, look it up in https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json and append a row to the `wayback` map; also add the year to the three `<select id="esri-year*">` dropdowns in `public/index.html`. The Wayback proxy in `server/routes/tiles.js` follows redirects and needs no further change.
- No multi-user / authentication — assumes single-user localhost
- No geometry projection support — input is assumed to be WGS84 (EPSG:4326)

---

## Testing Manually

A short smoke-test checklist after a change:

1. `npm start` — server logs the URL, no crash
2. Open `http://localhost:3000` — no errors in DevTools console
3. Load Demo Data — 10 plots appear, MOLCA classes show in right panel
4. Click a plot → map flies to it, square overlay appears
5. Press `1` → first class selected, then `Enter` → submitted, next plot loads
6. **⚙ Settings** → status badges match `.env` content
7. **✏ Class Editor** → add a class, save, button appears in right panel
8. **↓ CSV / ↓ GeoJSON** → files download with classified results
9. Create a new project from the demo CSV — appears in left sidebar
10. **↓** in sidebar → project JSON downloads; **📂** to re-import → loads correctly
