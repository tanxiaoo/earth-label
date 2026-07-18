# Roadmap — Ideas & Future Improvements

Planned or proposed work that is **not implemented yet**. Items here have been
thought through enough to build on, but ship in a future release.

---

## 1. Label transfer between assessment modes (response-design change)

**Problem.** Switching a project's assessment mode or grid geometry (e.g. pixel
5×5 → grid 3×3, or 3×3 cells → 4×4 cells) invalidates the per-unit labels
already collected: since v2.3.0 the app safely refuses to reuse them (units
re-appear unclassified and the stored result is only restored when its
recorded geometry matches the current settings), so plots must be re-labelled.

**Background.** This is a known methodological issue, not just a UI gap:

- A label is only a valid observation under the **response design** it was
  collected with (Olofsson et al. 2014, *Good practices for estimating area
  and assessing accuracy of land change*, RSE 148:42–57). A sub-point label
  (point observation) and a cell label (area judgment) are different
  measurements.
- Converting between them is a **change-of-support** problem (Gotway & Young
  2002, *Combining incompatible spatial data*): point→area, area→point and
  area→area transfers each have known statistical behaviour.
- **Collect Earth Online** freezes the sample design once a project is
  published; the supported workflow for a design change is *copying the
  project* and re-collecting. There is no off-the-shelf standard for actually
  transferring labels across designs.
- Systematic point grids are unbiased estimators of area fraction (dot-grid /
  point-count tradition: ASTM E562, stereology, SamplePoint) — which
  quantifies what a transferred point label is worth as cell evidence.

**Proposed design (phased):**

*Principles:* transfers are **drafts, never observations** — a mode/geometry
change never silently rewrites results; transferred labels are flagged
`derived`, require per-plot review + resubmit, and exports mark each unit
label `observed` vs `transferred` so density statistics can exclude derived
ones. (The per-result geometry metadata added in v2.3.0 — `assessmentMode`,
`uaSizeM`, `subPointGrid`/`cellGrid`/`cellCoverageM` — is the foundation.)

*Phase 1 — CEO-style guardrail (recommended first):* when the user changes
mode/geometry on a project with results, offer an explicit choice instead of
just applying it:
1. **Archive & start fresh** (default) — current behaviour, made explicit;
2. **Duplicate project with new design** — the CEO workflow; old project
   untouched, ideal for comparing designs over the same points;
3. Cancel.

*Phase 2 — transfer rule matrix (drafts only, high-confidence transitions
first):*

| Transition | Rule | Confidence |
|---|---|---|
| pixel → grid (points → cells) | each sub-point falls in exactly one cell (half-open cell intervals for lattice points on borders); cell = majority of contained points; tie/empty → unlabeled | medium (dot-grid evidence) |
| grid → grid, nested (2×2↔4×4) | refine: children inherit parent; coarsen: majority of children, tie → unlabeled | high (exact geometry) |
| grid → grid, non-nested (3×3→2×2) | area-overlap weighted vote; no plurality → unlabeled | medium |
| grid → pixel (cells → points) | sub-point inherits containing cell's label — assumes within-cell homogeneity | low; **skip unless requested** |
| point mode ↔ anything | no unit transfer (plot label kept as display reference only) | — |
| UA size / inner-box change | overlap logic in metric space; uncovered new cells → unlabeled | depends on overlap |

*Phase 3 — provenance in exports:* per-unit `label_source`
(`observed` / `transferred` / `confirmed`) column in CSV/GeoJSON.

**Caveat.** For small validation sets, re-labelling under the new design is
often faster and cleaner than reviewing transferred drafts (which is why CEO
never built transfers). The transfer machinery pays off mainly for large
campaigns or expensive interpreters — hence the phasing, with the guardrail
and project duplication first.

---

## 2. Candidate smaller improvements

- **Adaptive zoom + UA subdivision guide lines + test harness** from the
  unmerged `feat/pixel-mode` branch — complementary to grid mode (its
  cell-center sub-point change is *not* wanted: pixel mode must keep the
  CEO-standard sub-point layout), but the zoom/guide-line/`npm test` parts
  are worth rebasing onto main.
- **Per-project git tag on release** (e.g. `v2.3.0` on the merge commit).
