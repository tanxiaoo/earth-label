#!/usr/bin/env python3
"""
Convenience script (NOT part of the app) — seed grid-mode cells from the point label.

Problem
-------
A project labelled in **pixel** mode carries a `subPoints` array on every plot
result. When the project is switched to **grid** (pixel/cell) mode, the app reads
`result.cells` instead of `result.subPoints`, so the existing labels look "gone" —
the cell grid renders empty.

What this does
--------------
For every plot result that has `subPoints` but no `cells`, it builds a `cells`
array where **each cell copies the label of the sub-point at the same position**
(cell idx and sub-point idx share the same row-major layout). That way, after
re-opening the project in grid mode, every cell already shows exactly what was
labelled at that spot in pixel mode, and you can go through them one by one and
correct. (If a sub-point is missing for some idx, that cell falls back to the
point's overall label.)

The cell grid mirrors the pixel `subPointGrid`, so the number and positions of
cells match the sub-points (e.g. "3x3" -> 9).

Safety
------
- Writes a timestamped `.bak` backup next to the file before saving.
- Idempotent: results that already have `cells` are left untouched (unless --force).
- Does NOT touch `subPoints`; they stay as a record of the pixel-mode pass.

What it also does
-----------------
It sets the whole project to grid (pixel/cell) mode (top-level `assessmentMode` +
`cellGrid`), so after running you can open the project in the app and it shows the
seeded cells right away — no need to switch modes first.

Usage
-----
    python seed_grid_cells_from_point.py path/to/proj.json
    python seed_grid_cells_from_point.py path/to/proj.json --dry-run   # preview only
    python seed_grid_cells_from_point.py path/to/proj.json --force     # rebuild cells
"""

import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path


def parse_grid(grid_str, fallback=9):
    """'3x3' -> 9 cells. Falls back if the string is malformed."""
    try:
        r, c = (int(x) for x in str(grid_str).lower().split("x"))
        return r * c
    except (ValueError, AttributeError):
        return fallback


def build_cells(sub_points, n, fallback_code, fallback_label):
    """One cell per idx 0..n-1, each copying the SUB-POINT label at the same idx.

    Cell idx and sub-point idx use the same row-major layout, so a cell inherits
    exactly what was labelled at that position in pixel mode. If a sub-point for
    an idx is missing, fall back to the point's overall label.
    """
    by_idx = {sp["idx"]: sp for sp in sub_points if "idx" in sp}
    cells = []
    for i in range(n):
        sp = by_idx.get(i)
        if sp and sp.get("code") is not None:
            cells.append({"idx": i, "code": sp["code"], "label": sp.get("label")})
        else:
            cells.append({"idx": i, "code": fallback_code, "label": fallback_label})
    return cells


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project",
                    help="Path to the project JSON (e.g. data/projects/proj_XXXX.json).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Report what would change without writing.")
    ap.add_argument("--force", action="store_true",
                    help="Rebuild cells even for results that already have them.")
    args = ap.parse_args()

    path = Path(args.project)
    if not path.is_file():
        sys.exit(f"Project file not found: {path}")

    proj = json.loads(path.read_text(encoding="utf-8"))

    prev_mode = proj.get("assessmentMode")

    results = proj.get("results") or {}
    if not results:
        sys.exit("No `results` in project — nothing to seed.")

    # The cell grid MUST mirror the pixel sub-point grid: cells inherit each
    # sub-point's label by matching idx (same row-major layout), so the grids
    # have to be the same size or the positions won't line up.
    cell_grid = proj.get("subPointGrid") or proj.get("cellGrid") or "3x3"
    n_cells = parse_grid(cell_grid)
    cover = proj.get("plotSizeM", 30)  # gridInnerSizeM 0 => cells cover the full UA square

    seeded, skipped_have_cells, skipped_no_label = 0, 0, 0

    for plot_id, r in results.items():
        code, label = r.get("code"), r.get("label")
        if code is None or label is None:
            skipped_no_label += 1
            continue
        if r.get("cells") and not args.force:
            skipped_have_cells += 1
            continue

        r["cells"] = build_cells(r.get("subPoints") or [], n_cells, code, label)
        # Mark the result as grid geometry so the app + exports read it correctly.
        r["assessmentMode"] = "grid"
        r["cellGrid"] = cell_grid
        r["cellCoverageM"] = cover
        seeded += 1

    # Put the whole project in grid mode so it opens ready to check, and make sure
    # cellGrid is set so the app renders the right number of cells.
    mode_changed = proj.get("assessmentMode") != "grid" or proj.get("cellGrid") != cell_grid
    proj["assessmentMode"] = "grid"
    proj["cellGrid"] = cell_grid

    print(f"Project : {path.name}")
    print(f"Mode    : {prev_mode!r} -> 'grid'"
          + ("  (unchanged)" if prev_mode == "grid" else ""))
    print(f"Cell grid: {cell_grid} ({n_cells} cells/plot)")
    print(f"Seeded  : {seeded} plot result(s) — every cell set to the point label")
    print(f"Skipped : {skipped_have_cells} already had cells, "
          f"{skipped_no_label} had no point label")

    if args.dry_run:
        print("\n[dry-run] No files written.")
        return

    if seeded == 0 and not mode_changed:
        print("\nNothing to write — already in grid mode with cells seeded.")
        return

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = path.with_suffix(f".{stamp}.bak.json")
    shutil.copy2(path, backup)
    path.write_text(json.dumps(proj, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nBackup  : {backup.name}")
    print(f"Written : {path.name}")
    print("Re-open the project in the app (grid mode). Every cell now shows the "
          "point's label — check them one by one and correct.")


if __name__ == "__main__":
    main()
