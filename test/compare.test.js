// Double-labeling review: buildReview() must flag every plot correctly, merge
// agreed results losslessly, and report agreement stats. Run with `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReview } = require('../server/lib/compare');

const SCHEMA = [
  { code: 20, label: 'Forest',   color: '#548235' },
  { code: 8,  label: 'Cropland', color: '#ffc000' },
  { code: 13, label: 'Built-up', color: '#ff0000' },
];
const FIELDS = [
  { key: 'notes',  label: 'Notes',  type: 'text' },
  { key: 'cloudy', label: 'Cloudy', type: 'binary' },
];
const LABEL = Object.fromEntries(SCHEMA.map(c => [c.code, c.label]));

function plots(n) {
  return Array.from({ length: n }, (_, i) => ({ id: String(i + 1), lat: 10 + i, lon: 20 + i, meta: {} }));
}

function project(name, results, extra = {}) {
  return {
    id: `proj_${name}`, name, classSchema: SCHEMA, annotationFields: FIELDS,
    plots: plots(4), results, assessmentMode: 'point', ...extra,
  };
}

function point(code, extra = {}) {
  return { code, label: LABEL[code], confidence: 'High', annotations: {}, assessmentMode: 'point', ...extra };
}

function pixel(code, unitCodes, extra = {}) {
  return {
    code, label: LABEL[code], confidence: 'High', annotations: {},
    assessmentMode: 'pixel', uaSizeM: 30, subPointGrid: '2x2', subPointCoverageM: 30,
    subPoints: unitCodes.map((c, idx) => ({ idx, code: c, label: LABEL[c] })),
    ...extra,
  };
}

test('point mode: agree / disagree / missing statuses', () => {
  const A = project('A', { 1: point(20), 2: point(20), 3: point(8) });
  const B = project('B', { 1: point(20), 2: point(8),  4: point(13) });
  const { project: rev, stats } = buildReview(A, B, { nameA: 'Ann', nameB: 'Bo' });

  const st = id => rev.review.items[id].status;
  assert.equal(st('1'), 'agree');
  assert.equal(st('2'), 'disagree');
  assert.equal(st('3'), 'missing_b');
  assert.equal(st('4'), 'missing_a');
  assert.equal(rev.type, 'review');

  // Only agreed plots are pre-filled as final results.
  assert.deepEqual(Object.keys(rev.results), ['1']);
  assert.equal(rev.results[1].resolvedBy, 'consensus');

  assert.equal(stats.bothLabeled, 2);
  assert.equal(stats.agree, 1);
  assert.equal(stats.disagree, 1);
  assert.equal(stats.missingA, 1);
  assert.equal(stats.missingB, 1);
  assert.equal(stats.agreementPct, 50);
  assert.equal(rev.review.labelers.A.name, 'Ann');
});

test('names default to project names; reviewer defaults to the review name', () => {
  const A = project('milan_imd_ann', {});
  const B = project('Milan_IMD_keerthana', {});
  const rev = buildReview(A, B).project;
  assert.equal(rev.review.labelers.A.name, 'milan_imd_ann');
  assert.equal(rev.review.labelers.B.name, 'Milan_IMD_keerthana');
  assert.equal(rev.name, 'Review — milan_imd_ann vs Milan_IMD_keerthana');
  assert.equal(rev.review.reviewer, rev.name);
  assert.equal(buildReview(A, B, { name: 'Milan check' }).project.review.reviewer, 'Milan check');
});

test('merge rules for agreed plots keep both labelers\' info', () => {
  const A = project('A', { 1: point(20, {
    confidence: 'High', annotations: { notes: 'dense canopy', cloudy: 'no' },
    imageSource: 'Google', imageDate: '2024-05', timeSpentSeconds: 12,
  }) });
  const B = project('B', { 1: point(20, {
    confidence: 'Low', annotations: { notes: 'maybe plantation', cloudy: 'yes' },
    imageSource: 'Google', imageDate: '2023-11', timeSpentSeconds: 30,
  }) });
  const r = buildReview(A, B, { nameA: 'Ann', nameB: 'Bo' }).project.results[1];

  // Both labelers' values are kept, named; identical values once.
  assert.equal(r.confidence, 'Ann: High | Bo: Low');
  assert.equal(r.annotations.notes, 'Ann: dense canopy | Bo: maybe plantation');
  assert.equal(r.annotations.cloudy, 'yes');
  assert.equal(r.imageSource, 'Google');
  assert.equal(r.imageDate, 'Ann: 2024-05 | Bo: 2023-11');
  assert.equal(r.timeSpentSeconds, 'Ann: 12 | Bo: 30');
});

test('merge: one empty note takes the other; legacy top-level notes are read', () => {
  const A = project('A', { 1: { code: 20, label: 'Forest', notes: 'legacy note' } });
  const B = project('B', { 1: point(20, { annotations: { notes: '' } }) });
  const r = buildReview(A, B).project.results[1];
  assert.equal(r.annotations.notes, 'legacy note');
  assert.equal(r.annotations.cloudy, '');
});

test('pixel mode: same class but different units → agree_partial', () => {
  const settings = { assessmentMode: 'pixel', subPointGrid: '2x2', plotSizeM: 30 };
  const A = project('A', { 1: pixel(20, [20, 20, 20, 8]) }, settings);
  const B = project('B', { 1: pixel(20, [20, 20, 8, 8]) }, settings);
  const { project: rev, stats } = buildReview(A, B);
  const item = rev.review.items[1];

  assert.equal(item.status, 'agree_partial');
  assert.equal(item.unitsComparable, true);
  assert.equal(item.unitAgreementPct, 75);
  assert.deepEqual(item.unitDiffIdx, [2]);
  assert.equal(stats.agreePartial, 1);
  assert.equal(stats.agreementPct, 100);

  // Differing unit comes from A: A has 3 units backing Forest, B has 2.
  const merged = rev.results[1];
  assert.equal(merged.unitSource, 'A');
  assert.deepEqual(merged.subPoints.map(u => u.code), [20, 20, 20, 8]);
});

test('pixel mode: identical units → plain agree', () => {
  const A = project('A', { 1: pixel(20, [20, 20, 8, 8]) });
  const B = project('B', { 1: pixel(20, [20, 20, 8, 8]) });
  const rev = buildReview(A, B).project;
  assert.equal(rev.review.items[1].status, 'agree');
  assert.equal(rev.review.items[1].unitAgreementPct, 100);
});

test('different grids → class-only comparison with a warning', () => {
  const A = project('A', { 1: pixel(20, [20, 20, 20, 20]) });
  const B = project('B', { 1: pixel(20, [20, 8, 8, 8, 20, 20, 20, 20, 20], { subPointGrid: '3x3' }) });
  const { project: rev, warnings } = buildReview(A, B);
  const item = rev.review.items[1];
  assert.equal(item.status, 'agree');
  assert.equal(item.unitsComparable, false);
  assert.equal(item.unitAgreementPct, null);
  assert.ok(warnings.some(w => /different mode or grid/.test(w)));
});

test('plot-id and coordinate mismatches are warnings; no overlap is an error', () => {
  const A = project('A', {});
  const B = project('B', {});
  B.plots = B.plots.slice(1);                  // B lacks plot 1
  B.plots.push({ id: '99', lat: 0, lon: 0 });  // B has an extra plot
  B.plots[0] = { ...B.plots[0], lat: B.plots[0].lat + 0.01 };
  const { project: rev, warnings } = buildReview(A, B);
  assert.ok(warnings.some(w => /only in A: 1/.test(w)));
  assert.ok(warnings.some(w => /only in B: 99/.test(w)));
  assert.ok(warnings.some(w => /different coordinates/.test(w)));
  assert.equal(rev.plots.length, 5);           // union of both

  const C = project('C', {});
  C.plots = [{ id: 'x', lat: 0, lon: 0 }];
  assert.throws(() => buildReview(A, C), /share no plot IDs/);
});

test('schema differences are reported and unioned', () => {
  const A = project('A', {});
  const B = project('B', {}, { classSchema: [
    { code: 20, label: 'Trees', color: '#000' },
    { code: 99, label: 'Other', color: '#111' },
  ] });
  const { project: rev, warnings } = buildReview(A, B);
  assert.ok(warnings.some(w => /code 20 is "Forest" in A but "Trees" in B/.test(w)));
  assert.ok(warnings.some(w => /code 99 .* only exists in B/.test(w)));
  assert.ok(rev.classSchema.some(c => c.code === 99));
  assert.equal(rev.classSchema.find(c => c.code === 20).label, 'Forest');
});

test('Cohen\'s kappa matches a hand-computed value', () => {
  // 10 plots. A: 6 Forest, 4 Crop. B: 6 Forest, 4 Crop. 8 agreements.
  // po = 0.8; pe = 0.6*0.6 + 0.4*0.4 = 0.52; kappa = (0.8-0.52)/(1-0.52) = 0.5833
  const pairs = [[20,20],[20,20],[20,20],[20,20],[20,20],[20,8],[8,8],[8,8],[8,8],[8,20]];
  const n = pairs.length;
  const mk = side => ({
    id: `p${side}`, name: side, classSchema: SCHEMA,
    plots: Array.from({ length: n }, (_, i) => ({ id: String(i), lat: i, lon: i })),
    results: Object.fromEntries(pairs.map((pr, i) => [i, point(pr[side === 'A' ? 0 : 1])])),
  });
  const { stats } = buildReview(mk('A'), mk('B'));
  assert.equal(stats.agreementPct, 80);
  assert.equal(stats.kappa, 0.5833);
});

test('a review project cannot be a source', () => {
  const A = project('A', {});
  const R = { ...project('R', {}), type: 'review' };
  assert.throws(() => buildReview(A, R), /cannot be used as a source/);
});

test('compare by an uploaded column: values map to classes by code or label', () => {
  const withMeta = (name, values) => {
    const p = project(name, {});
    p.plots = p.plots.map((pl, i) => ({ ...pl, meta: { lulc: values[i] } }));
    return p;
  };
  // plot 1: code vs label of the same class; 2: different classes;
  // 3: same unmatched value; 4: missing in B
  const A = withMeta('A', ['20',     '8',  'Swamp', '13']);
  const B = withMeta('B', ['forest', '20', 'swamp', '']);
  const { project: rev, stats, warnings } = buildReview(A, B, { compareBy: 'lulc' });
  const st = id => rev.review.items[id].status;

  assert.equal(rev.review.compareBy, 'lulc');
  assert.equal(st('1'), 'agree');
  assert.equal(st('2'), 'disagree');
  assert.equal(st('3'), 'agree');
  assert.equal(st('4'), 'missing_b');
  assert.equal(rev.review.items['1'].valueB, 'forest');
  assert.equal(rev.review.items['1'].classB, 20);

  // Only the agreed value that names a class is pre-filled.
  assert.deepEqual(Object.keys(rev.results), ['1']);
  assert.equal(rev.results['1'].code, 20);
  assert.equal(rev.results['1'].resolvedBy, 'consensus');
  assert.equal(stats.bothLabeled, 3);
  assert.ok(warnings.some(w => /name no class/.test(w) && /Swamp/.test(w)));
});

test('compare by a column missing from one project is an error', () => {
  const A = project('A', {});
  A.plots = A.plots.map(p => ({ ...p, meta: { lulc: '20' } }));
  const B = project('B', {});
  assert.throws(() => buildReview(A, B, { compareBy: 'lulc' }), /not in both projects/);
});

test('compare by column in grid/pixel mode keeps the unit rules (partial, merged units)', () => {
  const withMeta = (name, results, values) => {
    const p = project(name, results, { assessmentMode: 'pixel', subPointGrid: '2x2', plotSizeM: 30 });
    p.plots = p.plots.map((pl, i) => ({ ...pl, meta: { imperv_level: values[i] } }));
    return p;
  };
  // plot 1: column agrees, units differ → partial; plot 2: column agrees,
  // units identical → agree; plot 3: column differs → disagree.
  const A = withMeta('A', {
    1: pixel(13, [13, 13, 13, 20]), 2: pixel(20, [20, 20, 20, 20]), 3: pixel(13, [13, 13, 13, 13]),
  }, ['3/4', '0/4', '4/4', '']);
  const B = withMeta('B', {
    1: pixel(13, [13, 13, 20, 20]), 2: pixel(20, [20, 20, 20, 20]), 3: pixel(13, [13, 13, 13, 13]),
  }, ['3/4', '0/4', '2/4', '']);
  const { project: rev, stats } = buildReview(A, B, { compareBy: 'imperv_level' });
  const it = id => rev.review.items[id];

  assert.equal(it('1').status, 'agree_partial');
  assert.equal(it('1').unitAgreementPct, 75);
  assert.deepEqual(it('1').unitDiffIdx, [2]);
  assert.equal(it('2').status, 'agree');
  assert.equal(it('3').status, 'disagree');           // same EarthLabel class, but the column differs
  assert.equal(it('4').status, 'missing_both');
  assert.equal(stats.agreePartial, 1);

  // Agreed plots get the merged EarthLabel result (units included), as in class mode.
  assert.equal(rev.results['1'].code, 13);
  assert.deepEqual(rev.results['1'].subPoints.map(u => u.code), [13, 13, 13, 20]);
  assert.equal(rev.results['2'].code, 20);
  assert.equal(rev.results['3'], undefined);
});

test('uploaded-file columns: identical kept once, different kept per labeler', () => {
  const withMeta = (name, metas) => {
    const p = project(name, {});
    p.plots = p.plots.map((pl, i) => ({ ...pl, meta: metas[i] }));
    return p;
  };
  const A = withMeta('A', [
    { tile: 'T1', imperv_level: '7/9', a_only: 'x' },
    { tile: 'T2', imperv_level: '0/9' },
    { tile: 'T3', imperv_level: '5/9' },
    { tile: 'T4', imperv_level: '1/9' },
  ]);
  const B = withMeta('B', [
    { tile: 'T1', imperv_level: '7/9', b_only: 'y' },
    { tile: 'T2', imperv_level: '0/9' },
    { tile: 'T3', imperv_level: '4/9' },   // differs → split for every plot
    { tile: 'T4', imperv_level: '1/9' },
  ]);
  const rev = buildReview(A, B, { nameA: 'Xiao', nameB: 'Keerthana R.' }).project;
  assert.deepEqual(rev.plots[0].meta, {
    tile: 'T1', imperv_level_xiao: '7/9', imperv_level_keerthana_r: '7/9', a_only: 'x', b_only: 'y',
  });
  assert.deepEqual(rev.plots[2].meta, { tile: 'T3', imperv_level_xiao: '5/9', imperv_level_keerthana_r: '4/9' });
});
