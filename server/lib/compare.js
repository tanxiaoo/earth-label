// Double-labeling review: compare two labelers' projects built from the same
// point file and produce a "review" project for a third person to resolve.
// Pure functions only (no I/O) so the whole comparison is unit-testable.

const UA_KEYS = [
  'assessmentMode', 'plotSizeM', 'pointBoxSizeM', 'subPointGrid', 'pixelInnerSizeM',
  'pixelGridLines', 'cellGrid', 'gridInnerSizeM', 'aggregationRule', 'aggregationThreshold',
];

const COORD_TOL_DEG = 1e-6;

// A result counts as labeled only when it carries a class code.
function _labeled(r) {
  return !!r && r.code != null && r.code !== '';
}

// Legacy results stored a top-level `notes` instead of an annotations object.
function _annotationsOf(r) {
  if (!r) return {};
  return r.annotations ?? (r.notes != null ? { notes: r.notes } : {});
}

// Same inference as the CSV exporter: stored mode, else the data shape.
function _modeOf(r) {
  if (r?.assessmentMode) return r.assessmentMode;
  if (r?.cells)          return 'grid';
  if (r?.subPoints)      return 'pixel';
  return 'point';
}

function _unitsOf(r) {
  return _modeOf(r) === 'grid' ? (r?.cells || []) : (r?.subPoints || []);
}

// Everything that decides where a result's units sit on the ground. Two
// results are unit-comparable only when these keys are identical.
function _geometryKey(r, proj) {
  const mode = _modeOf(r);
  if (mode === 'point') return 'point';
  const ua = r.uaSizeM ?? proj.plotSizeM ?? 30;
  if (mode === 'grid') {
    return `grid|${r.cellGrid ?? proj.cellGrid ?? '3x3'}|${r.cellCoverageM ?? ua}|${ua}`;
  }
  return `pixel|${r.subPointGrid ?? proj.subPointGrid ?? '5x5'}|${r.subPointCoverageM ?? ua}|${ua}`;
}

function _blank(v) {
  return v == null || String(v).trim() === '';
}

// ── Compare by an uploaded-file column ────────────────────────────────────
// Numbers compare numerically ("20" = "20.0"); text case-insensitively.
function _normValue(v) {
  const s = String(v).trim();
  const n = Number(s);
  return s !== '' && Number.isFinite(n) ? `n:${n}` : `s:${s.toLowerCase()}`;
}

// A column value → schema class, by code first, then by label.
function _matchClass(v, schema) {
  const key = _normValue(v);
  return schema.find(c => _normValue(c.code) === key)
      || schema.find(c => _normValue(c.label) === key)
      || null;
}

// Equal → value; one empty → the other; both differ → "A: x | B: y".
function _mergeText(a, b, nameA, nameB) {
  if (_blank(a)) return _blank(b) ? '' : b;
  if (_blank(b) || String(a) === String(b)) return a;
  return `${nameA}: ${a} | ${nameB}: ${b}`;
}

// Yes / No flags: "yes" if either labeler flagged it, else "no" if either answered.
function _mergeBinary(a, b) {
  if (a === 'yes' || b === 'yes') return 'yes';
  if (a === 'no'  || b === 'no')  return 'no';
  return '';
}

// Per-unit comparison of two unit arrays ({idx, code, label}).
function _compareUnits(unitsA, unitsB) {
  const byA = new Map(unitsA.map(u => [u.idx, u]));
  const byB = new Map(unitsB.map(u => [u.idx, u]));
  const idxs = [...new Set([...byA.keys(), ...byB.keys()])].sort((x, y) => x - y);
  const diffIdx = [];
  let same = 0;
  for (const i of idxs) {
    const a = byA.get(i), b = byB.get(i);
    if (a && b && String(a.code) === String(b.code)) same++;
    else diffIdx.push(i);
  }
  return {
    total: idxs.length,
    diffIdx,
    pct: idxs.length ? parseFloat((same / idxs.length * 100).toFixed(1)) : null,
    byA, byB, idxs,
  };
}

// Final units for an agree_partial plot: shared units kept; differing units
// come from the labeler whose units back the agreed class more (tie → A).
function _mergeUnits(cmp, finalCode) {
  const supports = m => [...m.values()].filter(u => String(u.code) === String(finalCode)).length;
  const unitSource = supports(cmp.byB) > supports(cmp.byA) ? 'B' : 'A';
  const primary   = unitSource === 'A' ? cmp.byA : cmp.byB;
  const secondary = unitSource === 'A' ? cmp.byB : cmp.byA;
  const units = cmp.idxs
    .map(i => primary.get(i) || secondary.get(i))
    .filter(Boolean)
    .map(u => ({ idx: u.idx, code: u.code, label: u.label }));
  return { units, unitSource };
}

function _mergeResults(rA, rB, fields, names, cmp) {
  const annA = _annotationsOf(rA), annB = _annotationsOf(rB);
  const annotations = {};
  for (const f of fields) {
    annotations[f.key] = f.type === 'binary'
      ? _mergeBinary(annA[f.key], annB[f.key])
      : _mergeText(annA[f.key], annB[f.key], names.A, names.B);
  }

  const merged = {
    code:        rA.code,
    label:       rA.label || rB.label || '',
    // Consensus rows keep both labelers' values, named ("xiao: High |
    // keerthana: Low"); identical values are written once. A row the
    // reviewer labels is replaced by the reviewer's own values.
    confidence:  _mergeText(rA.confidence, rB.confidence, names.A, names.B),
    annotations,
    imageSource: _mergeText(rA.imageSource, rB.imageSource, names.A, names.B),
    imageDate:   _mergeText(rA.imageDate,   rB.imageDate,   names.A, names.B),
    timeSpentSeconds: _mergeText(rA.timeSpentSeconds, rB.timeSpentSeconds, names.A, names.B),
    assessmentMode:   _modeOf(rA),
    resolvedBy:       'consensus',
  };

  // Carry the assessment geometry (identical for both when units compare).
  for (const k of ['uaSizeM', 'subPointGrid', 'subPointCoverageM', 'cellGrid', 'cellCoverageM']) {
    if (rA[k] != null) merged[k] = rA[k];
  }
  const unitKey = merged.assessmentMode === 'grid' ? 'cells' : 'subPoints';
  if (merged.assessmentMode !== 'point' && cmp) {
    if (cmp.diffIdx.length) {
      const { units, unitSource } = _mergeUnits(cmp, merged.code);
      merged[unitKey]   = units;
      merged.unitSource = unitSource;
    } else {
      merged[unitKey] = _unitsOf(rA).map(u => ({ idx: u.idx, code: u.code, label: u.label }));
    }
  } else if (Array.isArray(rA[unitKey])) {
    // Units not comparable: keep A's so the row still has a consistent set.
    merged[unitKey]   = rA[unitKey];
    merged.unitSource = 'A';
  }
  return merged;
}

// Cohen's kappa over the plots both labelers classified.
function _kappa(pairs) {
  const n = pairs.length;
  if (!n) return null;
  const countA = {}, countB = {};
  let agree = 0;
  for (const [a, b] of pairs) {
    countA[a] = (countA[a] || 0) + 1;
    countB[b] = (countB[b] || 0) + 1;
    if (a === b) agree++;
  }
  const po = agree / n;
  let pe = 0;
  for (const c of Object.keys(countA)) pe += (countA[c] / n) * ((countB[c] || 0) / n);
  if (pe === 1) return po === 1 ? 1 : null;
  return parseFloat(((po - pe) / (1 - pe)).toFixed(4));
}

function _unionSchema(a, b, warnings) {
  const out = (a || []).map(c => ({ ...c }));
  const byCode = new Map(out.map(c => [String(c.code), c]));
  for (const c of (b || [])) {
    const hit = byCode.get(String(c.code));
    if (!hit) {
      warnings.push(`Class code ${c.code} ("${c.label}") only exists in B's schema — added.`);
      out.push({ ...c });
      byCode.set(String(c.code), c);
    } else if (hit.label !== c.label) {
      warnings.push(`Class code ${c.code} is "${hit.label}" in A but "${c.label}" in B — using A's label.`);
    }
  }
  for (const c of (a || [])) {
    if (!(b || []).some(x => String(x.code) === String(c.code))) {
      warnings.push(`Class code ${c.code} ("${c.label}") only exists in A's schema.`);
    }
  }
  return out;
}

function _unionFields(a, b) {
  const out = [];
  const seen = new Set();
  for (const f of [...(a || []), ...(b || [])]) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    out.push({ key: f.key, label: f.label, type: f.type });
  }
  return out.length ? out : [{ key: 'notes', label: 'Notes', type: 'text' }];
}

// Column-name suffix for a labeler: "Keerthana R." → "keerthana_r".
function _slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Column suffixes for the two labelers; kept distinct when the names slug alike.
function _suffixes(names) {
  let sA = _slug(names.A) || 'a', sB = _slug(names.B) || 'b';
  if (sA === sB) { sA += '_a'; sB += '_b'; }
  return { A: sA, B: sB };
}

// Merge A's and B's uploaded-file columns (plot.meta). Every column is always
// kept once per labeler, suffixed with their name (imperv_level_xiao /
// imperv_level_keerthana) — whatever the values — so the same inputs always
// give the same columns. Order: A's file order, then columns only B has;
// A's column right before B's. Returns {plotId: meta}.
function _mergeMeta(ids, plotsA, plotsB, names) {
  const keys = [];
  const seen = new Set();
  for (const map of [plotsA, plotsB]) {
    for (const p of map.values()) {
      for (const k of Object.keys(p.meta || {})) if (!seen.has(k)) { seen.add(k); keys.push(k); }
    }
  }
  const { A: sA, B: sB } = _suffixes(names);

  const out = {};
  for (const id of ids) {
    const mA = plotsA.get(id)?.meta || {}, mB = plotsB.get(id)?.meta || {};
    const meta = {};
    for (const k of keys) {
      meta[`${k}_${sA}`] = mA[k] ?? '';
      meta[`${k}_${sB}`] = mB[k] ?? '';
    }
    out[id] = meta;
  }
  return out;
}

// Warnings listing many plot ids are truncated so the modal stays readable.
function _idList(ids) {
  const shown = ids.slice(0, 10).join(', ');
  return ids.length > 10 ? `${shown} … (+${ids.length - 10} more)` : shown;
}

/**
 * Compare labeler A's and B's projects and build a review project.
 * Returns { project, stats, warnings }. The project has no id/created
 * timestamps — the caller assigns those. Throws if no plot ids overlap.
 */
function buildReview(projA, projB, opts = {}) {
  if (!projA || !Array.isArray(projA.plots)) throw new Error('Project A is not a valid EarthLabel project');
  if (!projB || !Array.isArray(projB.plots)) throw new Error('Project B is not a valid EarthLabel project');
  if (projA.type === 'review' || projB.type === 'review') {
    throw new Error('A review project cannot be used as a source — pick the labelers\' projects');
  }

  const names = {
    A: (opts.nameA || '').trim() || projA.name || 'A',
    B: (opts.nameB || '').trim() || projB.name || 'B',
  };
  const warnings = [];

  const plotsA = new Map(projA.plots.map(p => [String(p.id), p]));
  const plotsB = new Map(projB.plots.map(p => [String(p.id), p]));
  const shared = [...plotsA.keys()].filter(id => plotsB.has(id));
  if (!shared.length) {
    throw new Error('The two projects share no plot IDs — were they created from the same point file?');
  }

  const onlyA = [...plotsA.keys()].filter(id => !plotsB.has(id));
  const onlyB = [...plotsB.keys()].filter(id => !plotsA.has(id));
  if (onlyA.length) warnings.push(`${onlyA.length} plot(s) only in A: ${_idList(onlyA)}`);
  if (onlyB.length) warnings.push(`${onlyB.length} plot(s) only in B: ${_idList(onlyB)}`);

  const coordMismatch = shared.filter(id => {
    const a = plotsA.get(id), b = plotsB.get(id);
    return Math.abs(a.lat - b.lat) > COORD_TOL_DEG || Math.abs(a.lon - b.lon) > COORD_TOL_DEG;
  });
  if (coordMismatch.length) {
    warnings.push(`${coordMismatch.length} plot(s) have different coordinates in A and B (using A's): ${_idList(coordMismatch)}`);
  }

  const classSchema      = _unionSchema(projA.classSchema, projB.classSchema, warnings);
  const annotationFields = _unionFields(projA.annotationFields, projB.annotationFields);

  // A's plot order first, then plots that only B has. Uploaded-file columns
  // of both labelers are merged (see _mergeMeta).
  const basePlots = [
    ...projA.plots,
    ...projB.plots.filter(p => !plotsA.has(String(p.id))),
  ];
  const mergedMeta = _mergeMeta(basePlots.map(p => String(p.id)), plotsA, plotsB, names);
  const plots = basePlots.map(p => ({ ...p, geometry: p.geometry ?? null, meta: mergedMeta[String(p.id)] }));

  // Sub-point / cell comparison of A's and B's EarthLabel results (pixel /
  // grid mode). Sets the item's unit fields; null when there are no
  // comparable units.
  function _unitCompare(item, rA, rB, id) {
    if (_modeOf(rA) === 'point' && _modeOf(rB) === 'point') return null;
    item.unitsComparable = _geometryKey(rA, projA) === _geometryKey(rB, projB);
    if (!item.unitsComparable) { geomMismatch.push(id); return null; }
    const cmp = _compareUnits(_unitsOf(rA), _unitsOf(rB));
    item.unitAgreementPct = cmp.pct;
    item.unitDiffIdx      = cmp.diffIdx;
    return cmp;
  }

  // Majority class of a result's units (used when A's and B's EarthLabel
  // classes differ but the compared column agrees).
  function _majorityOfUnits(units) {
    const counts = {};
    for (const u of units || []) {
      const k = String(u.code);
      counts[k] = counts[k] || { code: u.code, label: u.label, n: 0 };
      counts[k].n++;
    }
    const win = Object.values(counts).sort((a, b) => b.n - a.n)[0];
    if (!win) return null;
    const cls = classSchema.find(c => String(c.code) === String(win.code));
    return { code: win.code, label: cls?.label || win.label };
  }

  // Column mode: the same rules as the class comparison — agree / partial /
  // disagree, unit comparison, merged Final — except that the compared
  // column's values decide whether A and B agree.
  function _compareColumn(item, vA, vB, id) {
    const hasA = !_blank(vA), hasB = !_blank(vB);
    const cA = hasA ? _matchClass(vA, classSchema) : null;
    const cB = hasB ? _matchClass(vB, classSchema) : null;
    item.valueA = hasA ? String(vA).trim() : null;
    item.valueB = hasB ? String(vB).trim() : null;
    item.classA = cA ? cA.code : null;
    item.classB = cB ? cB.code : null;
    const rA = item.A, rB = item.B;
    const cmp = rA && rB ? _unitCompare(item, rA, rB, id) : null;

    if (!hasA || !hasB) {
      item.status = hasA ? 'missing_b' : hasB ? 'missing_a' : 'missing_both';
      if (hasA) stats.missingB++; else if (hasB) stats.missingA++; else stats.missingBoth++;
      return;
    }
    stats.bothLabeled++;
    const kA = cA ? `c:${cA.code}` : _normValue(vA);
    const kB = cB ? `c:${cB.code}` : _normValue(vB);
    pairs.push([kA, kB]);
    if (kA !== kB) { item.status = 'disagree'; stats.disagree++; return; }

    item.status = cmp && cmp.diffIdx.length ? 'agree_partial' : 'agree';
    if (item.status === 'agree') stats.agree++; else stats.agreePartial++;

    // Final: A's and B's EarthLabel results merged as usual; the class the
    // value names wins; otherwise the shared class, or the merged units' majority.
    let merged = rA && rB ? _mergeResults(rA, rB, annotationFields, names, cmp) : null;
    if (cA) {
      merged = {
        ...(merged || { confidence: null, annotations: {}, assessmentMode: projA.assessmentMode || 'point' }),
        code: cA.code, label: cA.label, resolvedBy: 'consensus',
      };
    } else if (merged && String(rA.code) !== String(rB.code)) {
      const maj = _majorityOfUnits(merged.cells || merged.subPoints);
      merged = maj ? { ...merged, ...maj } : null;
    }
    if (merged) results[id] = { ...merged, savedAt: new Date().toISOString() };
    else unmatched.add(item.valueA);
  }

  const resA = projA.results || {};
  const resB = projB.results || {};
  const items = {};
  const results = {};
  const pairs = [];
  const geomMismatch = [];
  const stats = {
    total: plots.length, bothLabeled: 0,
    agree: 0, agreePartial: 0, disagree: 0,
    missingA: 0, missingB: 0, missingBoth: 0,
    agreementPct: null, kappa: null,
  };

  // Default: compare the EarthLabel class. Optionally an uploaded-file column
  // present in both projects (labels made outside EarthLabel).
  const compareBy = String(opts.compareBy || '').trim() || null;
  if (compareBy) {
    const has = proj => proj.plots.some(p => p.meta && Object.prototype.hasOwnProperty.call(p.meta, compareBy));
    if (!has(projA) || !has(projB)) throw new Error(`Column "${compareBy}" is not in both projects' uploaded files`);
  }
  const unmatched = new Set();

  for (const p of plots) {
    const id = String(p.id);
    const rA = _labeled(resA[p.id]) ? resA[p.id] : null;
    const rB = _labeled(resB[p.id]) ? resB[p.id] : null;
    const item = { status: null, A: rA, B: rB, unitAgreementPct: null, unitsComparable: null, unitDiffIdx: [] };
    // B's reference, only when it differs from A's (the export then splits ref_*).
    const pA = plotsA.get(id), pB = plotsB.get(id);
    if (pA && pB && (String(pA.refCode ?? '') !== String(pB.refCode ?? '') ||
                     String(pA.refLabel ?? '') !== String(pB.refLabel ?? ''))) {
      item.refB = { code: pB.refCode ?? null, label: pB.refLabel ?? null };
    }

    if (compareBy) {
      _compareColumn(item, plotsA.get(id)?.meta?.[compareBy], plotsB.get(id)?.meta?.[compareBy], id);
      items[id] = item;
      continue;
    }

    if (rA && rB) {
      stats.bothLabeled++;
      pairs.push([String(rA.code), String(rB.code)]);

      const cmp = _unitCompare(item, rA, rB, id);

      if (String(rA.code) === String(rB.code)) {
        item.status = cmp && cmp.diffIdx.length ? 'agree_partial' : 'agree';
        if (item.status === 'agree') stats.agree++; else stats.agreePartial++;
        results[p.id] = {
          ..._mergeResults(rA, rB, annotationFields, names, cmp),
          savedAt: new Date().toISOString(),
        };
      } else {
        item.status = 'disagree';
        stats.disagree++;
      }
    } else if (rA) {
      item.status = 'missing_b'; stats.missingB++;
    } else if (rB) {
      item.status = 'missing_a'; stats.missingA++;
    } else {
      item.status = 'missing_both'; stats.missingBoth++;
    }
    items[id] = item;
  }

  if (unmatched.size) {
    const vals = [...unmatched];
    warnings.push(`${vals.length} agreed value(s) of "${compareBy}" name no class and the labelers' EarthLabel labels can't settle them (${_idList(vals)}) — those plots are left for the reviewer.`);
  }
  if (geomMismatch.length) {
    warnings.push(`${geomMismatch.length} plot(s) were assessed with a different mode or grid in A and B — only the final class is compared: ${_idList(geomMismatch)}`);
  }
  const uaDiff = UA_KEYS.filter(k => projA[k] != null && projB[k] != null && projA[k] !== projB[k]);
  if (uaDiff.length) warnings.push(`Assessment settings differ (${uaDiff.join(', ')}) — the review uses A's settings.`);

  if (stats.bothLabeled) {
    stats.agreementPct = parseFloat(((stats.agree + stats.agreePartial) / stats.bothLabeled * 100).toFixed(1));
    stats.kappa = _kappa(pairs);
  }

  // Labelers are identified by their project names; the reviewer by the
  // review project's name unless one is passed explicitly.
  const name = (opts.name || '').trim() || `Review — ${names.A} vs ${names.B}`;
  const project = {
    type: 'review',
    name,
    classSchema,
    annotationFields,
    plots,
    results,
    review: {
      labelers: {
        A: { name: names.A, sourceProjectId: projA.id ?? null, sourceProjectName: projA.name ?? null },
        B: { name: names.B, sourceProjectId: projB.id ?? null, sourceProjectName: projB.name ?? null },
      },
      reviewer: (opts.reviewer || '').trim() || name,
      compareBy,                          // null = EarthLabel class
      items,
      stats,
      warnings,
    },
  };
  for (const k of UA_KEYS) if (projA[k] != null) project[k] = projA[k];

  return { project, stats, warnings };
}

/**
 * Rename labeler A and/or B of a review project (mutates and returns it).
 * Every place buildReview wrote a labeler's name is rewritten: the labelers
 * block, the "A: x | B: y" values of consensus results, and the
 * per-labeler uploaded-file columns (imperv_level_<a> / imperv_level_<b>).
 * Values the reviewer submitted are their own and are left alone.
 */
function renameLabelers(project, newNames) {
  const labelers = project.review.labelers;
  const old = { A: labelers.A.name, B: labelers.B.name };
  const nu  = {
    A: String(newNames.A ?? '').trim() || old.A,
    B: String(newNames.B ?? '').trim() || old.B,
  };
  if (nu.A === old.A && nu.B === old.B) return project;

  // "<old A>: x | <old B>: y" → "<new A>: x | <new B>: y"
  const head = `${old.A}: `, sep = ` | ${old.B}: `;
  const fix = v => {
    if (typeof v !== 'string' || !v.startsWith(head)) return v;
    const i = v.indexOf(sep, head.length);
    if (i < 0) return v;
    return `${nu.A}: ${v.slice(head.length, i)} | ${nu.B}: ${v.slice(i + sep.length)}`;
  };
  for (const r of Object.values(project.results || {})) {
    if (r?.resolvedBy !== 'consensus') continue;
    for (const k of ['confidence', 'imageSource', 'imageDate', 'timeSpentSeconds']) {
      if (k in r) r[k] = fix(r[k]);
    }
    if (r.annotations) {
      for (const k of Object.keys(r.annotations)) r.annotations[k] = fix(r.annotations[k]);
    }
  }

  // Suffixed columns come in pairs (<col>_<a>, <col>_<b>) in every plot; only
  // such pairs are renamed, so an unrelated column ending in a name is safe.
  const so = _suffixes(old), sn = _suffixes(nu);
  for (const p of project.plots || []) {
    if (!p.meta) continue;
    const meta = {};
    for (const [k, v] of Object.entries(p.meta)) {
      let key = k;
      for (const [side, other] of [['A', 'B'], ['B', 'A']]) {
        const suf = `_${so[side]}`;
        if (!k.endsWith(suf)) continue;
        const base = k.slice(0, -suf.length);
        if (`${base}_${so[other]}` in p.meta) { key = `${base}_${sn[side]}`; break; }
      }
      meta[key] = v;
    }
    p.meta = meta;
  }

  labelers.A.name = nu.A;
  labelers.B.name = nu.B;
  return project;
}

module.exports = { buildReview, renameLabelers, UA_KEYS };
