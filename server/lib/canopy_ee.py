#!/usr/bin/env python
"""Sample ECHOSAT tree canopy height at a point via Google Earth Engine.

Usage:
    python canopy_ee.py <lat> <lon> <year>

Prints one JSON line to stdout:
    {"heightM": 12.2, "year": 2024, "source": "ECHOSAT"}
On masked/no-data pixels (e.g. ocean):
    {"heightM": null, "year": 2024, "source": "ECHOSAT"}
On failure, prints {"error": "...", "code": "..."} and exits non-zero.

Auth: uses the machine's Earth Engine user credentials (run
`earthengine authenticate` once). The Cloud project is read from the
GEE_PROJECT environment variable so the repo is portable across users.

ECHOSAT (Pauls et al., AI4Forest / Uni Münster, CC-BY 4.0) is an
ImageCollection of per-MGRS-zone tiles; each tile has 7 bands b1..b7 for
years 2018..2024, Int16, values in centimetres. We mosaic the collection so
GEE resolves the covering tile per point automatically.
"""
import json
import os
import sys

ASSET = "projects/ai4forest/assets/echosat"
FIRST_YEAR = 2018
LAST_YEAR = 2024


def fail(msg, code):
    print(json.dumps({"error": str(msg), "code": code}))
    sys.exit(1)


def main():
    if len(sys.argv) != 4:
        fail("usage: canopy_ee.py <lat> <lon> <year>", "BAD_ARGS")

    try:
        lat = float(sys.argv[1])
        lon = float(sys.argv[2])
        year = int(sys.argv[3])
    except ValueError:
        fail("lat, lon must be numbers and year an integer", "BAD_ARGS")

    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        fail("lat/lon out of range", "BAD_ARGS")

    # Clamp the requested year into ECHOSAT's coverage; the route also does
    # this, but keep the helper self-defensive.
    used_year = max(FIRST_YEAR, min(LAST_YEAR, year))
    band = "b%d" % (used_year - FIRST_YEAR + 1)  # 2018 -> b1 ... 2024 -> b7

    project = os.environ.get("GEE_PROJECT", "").strip()
    if not project:
        fail("GEE_PROJECT not set", "NO_GEE_PROJECT")

    try:
        import ee
    except ImportError:
        fail("earthengine-api not installed (pip install earthengine-api)", "NO_EE")

    try:
        ee.Initialize(project=project)
    except Exception as e:  # noqa: BLE001 - surface any auth/init failure
        fail("Earth Engine init failed: %s" % e, "EE_AUTH")

    try:
        img = ee.ImageCollection(ASSET).mosaic().select(band)
        pt = ee.Geometry.Point([lon, lat])
        result = img.reduceRegion(ee.Reducer.first(), pt, 10).getInfo()
    except Exception as e:  # noqa: BLE001
        fail("Earth Engine query failed: %s" % e, "EE_QUERY")

    raw = result.get(band) if isinstance(result, dict) else None
    height_m = None if raw is None else round(raw / 100.0, 1)  # cm -> m

    out = {"heightM": height_m, "year": used_year, "source": "ECHOSAT"}
    if used_year != year:
        out["warning"] = (
            "ECHOSAT covers %d-%d; showing %d." % (FIRST_YEAR, LAST_YEAR, used_year)
        )
    print(json.dumps(out))


if __name__ == "__main__":
    main()
