# Classification Schemas

EarthLabel ships with 10 built-in LULC classification systems sourced from authoritative remote-sensing references. Each preset includes its official numeric codes, labels, and (where available) the canonical colormap.

You can use any preset as-is, or load it as a starting point and edit it via the **✏** Class Editor.

---

## 1. Binary (Positive / Negative)

For binary validation tasks (e.g. "is this pixel forest, yes or no?").

| Code | Label    | Color     |
|-----:|----------|-----------|
| 1    | Positive | `#22c55e` |
| 2    | Negative | `#ef4444` |

---

## 2. MOLCA 2019 (10 classes)

Morocco Land Cover Assessment — 10-class scheme used in Planet/Sentinel validation studies.

| Code | Label                   | Color     |
|-----:|-------------------------|-----------|
| 20   | Forest                  | `#548235` |
| 5    | Shrubland               | `#c6e0b4` |
| 7    | Grassland               | `#66ff33` |
| 8    | Cropland                | `#ffc000` |
| 9    | Wetland                 | `#9bc2e6` |
| 10   | Lichens and Mosses      | `#ededed` |
| 12   | Bareland                | `#bf8f00` |
| 13   | Built-up                | `#ff0000` |
| 15   | Water                   | `#1f4e78` |
| 16   | Permanent Ice and Snow  | `#e8e8ff` |

---

## 3. CORINE Land Cover Level 1 (5 classes)

EEA Copernicus CORINE Land Cover, Level-1 aggregation. Europe-wide, 100m.

> Source: <https://land.copernicus.eu/pan-european/corine-land-cover>

| Code | Label                          |
|-----:|--------------------------------|
| 1    | Artificial Surfaces            |
| 2    | Agricultural Areas             |
| 3    | Forest & Semi-natural Areas    |
| 4    | Wetlands                       |
| 5    | Water Bodies                   |

---

## 4. CORINE Land Cover Level 2 (15 classes)

EEA CORINE Level-2 aggregation. Europe-wide, 100m.

> Source: <https://land.copernicus.eu/pan-european/corine-land-cover>

15 classes covering urban fabric, industrial, mines, vegetated artificial, arable, permanent crops, pastures, heterogeneous agricultural, forests, shrub/herbaceous, sparse vegetation, inland and coastal wetlands, inland and marine waters.

---

## 5. IGBP / MODIS MCD12Q1 (17 classes)

International Geosphere-Biosphere Programme classification scheme. Used in NASA MODIS MCD12Q1 Land Cover Type 1 (LC_Type1) at 500m global resolution.

> Source: <https://lpdaac.usgs.gov/products/mcd12q1v006/>

| Code | Label                                       |
|-----:|---------------------------------------------|
| 1    | Evergreen Needleleaf Forests                |
| 2    | Evergreen Broadleaf Forests                 |
| 3    | Deciduous Needleleaf Forests                |
| 4    | Deciduous Broadleaf Forests                 |
| 5    | Mixed Forests                               |
| 6    | Closed Shrublands                           |
| 7    | Open Shrublands                             |
| 8    | Woody Savannas                              |
| 9    | Savannas                                    |
| 10   | Grasslands                                  |
| 11   | Permanent Wetlands                          |
| 12   | Croplands                                   |
| 13   | Urban and Built-up                          |
| 14   | Cropland / Natural Vegetation Mosaics       |
| 15   | Permanent Snow and Ice                      |
| 16   | Barren                                      |
| 17   | Water Bodies                                |

---

## 6. ESA CCI Land Cover (22 classes)

ESA Climate Change Initiative Land Cover — global annual maps at 300m (1992–2020). Uses the official LCCS-based colormap.

> Source: <https://www.esa-landcover-cci.org/>

22 classes from rainfed cropland (10) to permanent snow and ice (220), including detailed tree-cover types by leaf form (broadleaved/needleleaved) and seasonality (evergreen/deciduous).

---

## 7. NLCD 2021 (16 classes)

US National Land Cover Database 2021 — 30m resolution, Continental US. Uses the official MRLC colormap.

> Source: <https://www.mrlc.gov/data/nlcd-2021-land-cover-conus>

| Code | Label                            |
|-----:|----------------------------------|
| 11   | Open Water                       |
| 12   | Perennial Ice / Snow             |
| 21   | Developed, Open Space            |
| 22   | Developed, Low Intensity         |
| 23   | Developed, Medium Intensity      |
| 24   | Developed, High Intensity        |
| 31   | Barren Land                      |
| 41   | Deciduous Forest                 |
| 42   | Evergreen Forest                 |
| 43   | Mixed Forest                     |
| 52   | Shrub / Scrub                    |
| 71   | Herbaceous                       |
| 81   | Hay / Pasture                    |
| 82   | Cultivated Crops                 |
| 90   | Woody Wetlands                   |
| 95   | Emergent Herbaceous Wetlands     |

---

## 8. IPCC Land Use Categories (6 classes)

IPCC 2006 Guidelines for National Greenhouse Gas Inventories — 6 major land-use categories used for carbon accounting.

> Source: <https://www.ipcc-nggip.iges.or.jp/public/2006gl/>

| Code | Label        |
|-----:|--------------|
| 1    | Forest Land  |
| 2    | Cropland     |
| 3    | Grassland    |
| 4    | Wetlands     |
| 5    | Settlements  |
| 6    | Other Land   |

---

## 9. Anderson / USGS Level I (9 classes)

USGS land-use and land-cover classification system for use with remote-sensor data (Anderson et al. 1976), Level I. Foundational scheme that influenced many subsequent systems.

> Source: USGS Professional Paper 964 — <https://pubs.usgs.gov/pp/0964/report.pdf>

| Code | Label                       |
|-----:|-----------------------------|
| 1    | Urban or Built-up Land      |
| 2    | Agricultural Land           |
| 3    | Rangeland                   |
| 4    | Forest Land                 |
| 5    | Water                       |
| 6    | Wetland                     |
| 7    | Barren Land                 |
| 8    | Tundra                      |
| 9    | Perennial Snow or Ice       |

---

## 10. FROM-GLC (10 classes)

Finer Resolution Observation and Monitoring of Global Land Cover — Tsinghua University, 30m global map.

> Source: Gong et al. 2019 — <http://data.ess.tsinghua.edu.cn/>

| Code | Label              |
|-----:|--------------------|
| 1    | Cropland           |
| 2    | Forest             |
| 3    | Grassland          |
| 4    | Shrubland          |
| 5    | Wetland            |
| 6    | Water              |
| 7    | Tundra             |
| 8    | Impervious Surface |
| 9    | Bareland           |
| 10   | Snow and Ice       |

---

## 11. Custom

Empty schema. Use the Class Editor to add classes one by one, or import a CSV with `code,label,color,key` columns.

---

## Defining Your Own

The class editor (**✏** in the right panel) gives you full control:

| Field   | Description |
|---------|-------------|
| Color   | Hex color (color-picker UI) |
| Code    | Numeric class code (must be unique within a schema) |
| Label   | Display name |
| Key     | Single-character keyboard shortcut (optional) |

You can also:
- **Load preset** — replace the current schema with any of the built-in presets
- **↑ Import CSV** — load a schema from `code,label,color,key` CSV
- **↓ Export CSV** — share your custom schema as a CSV file

The schema is per-project — different projects can have different schemas. Existing classifications reference the class code, so changing labels or colors doesn't break previously-classified plots.

---

## Adding a New Built-in Preset

To bake a new preset into the codebase:

1. Edit `server/lib/class-presets.js`
2. Add a new entry following the existing structure:

```js
my_new_preset: {
  name: 'My Custom Schema',
  description: 'Brief description',
  source: 'Citation / source',
  url: 'https://...',
  classes: [
    { code: 1, label: 'Class A', color: '#abcdef', key: '1' },
    // ...
  ],
},
```

3. Restart the server. The new preset appears automatically in all preset dropdowns.
