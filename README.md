# EarthLabel

**Satellite Image Viewing & Interpretation Platform**

A lightweight, browser-based tool for satellite image interpretation and land cover validation. Built as an alternative to Collect Earth Online with multi-source high-resolution imagery support.

## Features

- **Multiple Basemaps** — Switch between Google Satellite, ESRI World Imagery, Bing Maps, Sentinel-2 Cloudless (2018–2024), and Planet PlanetScope (3m, monthly) with a single click
- **Split View** — Compare two imagery sources side by side (e.g. Google high-res vs Sentinel-2 2024)
- **Customizable Legend** — Define your own land cover classes with colors and keyboard shortcuts
- **Project Management** — Create multiple projects, each with its own dataset and progress tracking
- **Google Earth Pro Integration** — Auto-navigate Google Earth Pro to the current plot via a local KML server, with access to historical imagery and time slider
- **Keyboard Shortcuts** — Rapid classification with number keys, confidence levels, and navigation
- **Data Persistence** — Progress auto-saved to IndexedDB, survives browser restarts
- **CSV Import/Export** — Load your sample points as CSV, export classified results with confidence and notes

## Quick Start

### Local (no install needed)

Download or clone this repo, then open `molca_validator.html` directly in your browser — no server required.

```bash
git clone https://github.com/YOUR_USERNAME/earth-label.git
cd earth-label
# Option A: open the file directly
start molca_validator.html

# Option B: serve with a local server (needed for KML integration)
python -m http.server 8000
# Then open http://localhost:8000/molca_validator.html
```

## CSV Format

Your input CSV must include at least `PLOTID`, `LAT`, and `LON` columns. Additional columns (e.g. reference class) are preserved in the export.

```csv
PLOTID,LAT,LON,class_code,class_label
1,0.5856,27.7400,20,Forest
2,7.5617,13.7757,5,Shrubland
```

## Google Earth Pro Integration (Optional)

For access to high-resolution historical imagery with date control:

1. Install [Node.js](https://nodejs.org/)
2. Start the KML server:
   ```bash
   node server.js
   ```
3. Open Google Earth Pro
4. Open `google_earth_link.kml` — Google Earth Pro will now auto-follow your plot navigation
5. Use the time slider in Google Earth Pro to verify imagery dates

## Planet API Key (Optional)

To use Planet PlanetScope imagery (3m resolution, monthly mosaics):

1. Apply for a free API key through [ESA Earthnet](https://earth.esa.int/eogateway/) or [Planet Explorer](https://www.planet.com/explorer/)
2. Click the gear icon in the app sidebar
3. Paste your API key and save

## Imagery Sources

| Source | Resolution | Date Control | Free |
|--------|-----------|-------------|------|
| Google Satellite | Sub-meter | No | Yes |
| ESRI World Imagery | Sub-meter | No | Yes |
| Bing Maps | Sub-meter | No | Yes |
| Sentinel-2 Cloudless | 10m | Year (2018–2024) | Yes |
| Planet PlanetScope | 3m | Year + Month | Yes (API key required) |
| Google Earth Pro | Sub-meter | Full history | Yes (local only) |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1`–`9`, `0` | Select land cover class |
| `h` / `m` / `l` | Confidence: High / Medium / Low |
| `Enter` | Submit & go to next plot |
| `←` / `→` | Previous / Next plot |

## Tech Stack

- **Frontend:** Vanilla HTML/JS/CSS with [Leaflet](https://leafletjs.com/)
- **Storage:** IndexedDB (browser-based, no server needed)
- **Basemaps:** Google, ESRI, Bing, EOX Sentinel-2, Planet
- **Google Earth Pro link:** Node.js KML server (optional)

## License

[MIT License](LICENSE) — free to use, modify, and distribute with attribution.

## Acknowledgments

- [EOX](https://s2maps.eu/) for Sentinel-2 cloudless mosaics
- [Planet Labs](https://www.planet.com/) for PlanetScope imagery
- [Leaflet](https://leafletjs.com/) for the mapping library
- Inspired by [Collect Earth Online](https://collect.earth/) by FAO/SERVIR
