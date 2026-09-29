// Double-labeling review — UI for the third person who resolves the plots
// where labeler A and labeler B disagree. The comparison itself happens on
// the server (server/lib/compare.js); this module builds the "create review"
// modal, the A / B / Final compare card and the review-only chrome. Actions
// that change labels (accept / copy / relabel) live in app.js.
import { state } from './state.js';
import * as api from './api.js';

const $ = (id) => document.getElementById(id);

// status → [badge text, tooltip, css modifier]
const STATUS = {
  agree:         ['Agree',     'A and B agree',                          'agree'],
  agree_partial: ['Partial',   'Same class, but some units differ',       'partial'],
  disagree:      ['Disagree',  'A and B chose different classes',         'disagree'],
  missing_a:     ['Missing A', 'Labeled by B only',                       'missing'],
  missing_b:     ['Missing B', 'Labeled by A only',                       'missing'],
  missing_both:  ['Missing',   'Labeled by neither',                      'missing'],
};

// Filter groups: "disagree" = everything the reviewer must decide.
const NEEDS_REVIEW = new Set(['disagree', 'missing_a', 'missing_b', 'missing_both']);

function _esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

export function isReviewProject() {
  return state.project?.type === 'review';
}

export function reviewItem(plotId) {
  return state.review?.items?.[plotId] || null;
}

export function labelerName(side) {
  return state.review?.labelers?.[side]?.name || side;
}

// Plot-list filter for review projects: 'disagree' | 'partial', strictly by
// the plot's A-vs-B status.
export function matchesReviewFilter(plotId, filter) {
  const st = reviewItem(plotId)?.status;
  if (filter === 'disagree') return NEEDS_REVIEW.has(st);
  if (filter === 'partial')  return st === 'agree_partial';
  return true;
}

// Status badge shown in the plot list (in place of the reference label).
export function reviewBadgeHtml(plotId) {
  const meta = STATUS[reviewItem(plotId)?.status];
  if (!meta) return '';
  return `<span class="rv-badge rv-${meta[2]}" title="${meta[1]}">${meta[0]}</span>`;
}

// ── Review-only chrome ────────────────────────────────────────────────────
// Show / hide everything that only makes sense in a review project.
export function renderReviewChrome() {
  const on = isReviewProject();
  ['filter-disagree', 'filter-partial'].forEach(id => $(id)?.classList.toggle('rv-off', !on));
  ['filter-pending', 'filter-done'].forEach(id => $(id)?.classList.toggle('rv-off', on));
  $('reviewCompareCard')?.classList.toggle('rv-off', !on);
  // Always visible in the toolbar; only usable in a review.
  const finalBtn = $('btn-final-map');
  if (finalBtn) finalBtn.disabled = !on;
  for (const [side, who] of [['left', 'A'], ['right', 'B']]) {
    const tag = $(`reviewPaneLabel-${side}`);
    if (!tag) continue;
    tag.classList.toggle('rv-off', !on);
    tag.textContent = on ? `${who} · ${labelerName(who)}` : '';
  }

  const banner = $('reviewStatsBadge');
  if (!banner) return;
  banner.classList.toggle('rv-off', !on);
  if (!on) { banner.innerHTML = ''; return; }

  const s = state.review?.stats || {};
  const warnings = state.review?.warnings || [];
  const kappa = s.kappa != null ? ` · κ ${s.kappa.toFixed(2)}` : '';
  const pct   = s.agreementPct != null ? `${s.agreementPct}%` : '–';
  banner.innerHTML =
    `<div><b>A</b> ${_esc(labelerName('A'))} · <b>B</b> ${_esc(labelerName('B'))}` +
    (state.review?.reviewer ? ` · reviewer ${_esc(state.review.reviewer)}` : '') + `</div>` +
    `<div>Agreement ${pct}${kappa} · ${s.disagree ?? 0} disagree · ${(s.missingA ?? 0) + (s.missingB ?? 0) + (s.missingBoth ?? 0)} missing</div>` +
    (warnings.length
      ? `<div class="rv-warn" title="${_esc(warnings.join('\n'))}">⚠ ${warnings.length} warning${warnings.length > 1 ? 's' : ''} (hover)</div>`
      : '');
}

// ── Compare card ──────────────────────────────────────────────────────────
function _cls(code) {
  return (state.project?.classSchema || []).find(c => String(c.code) === String(code));
}

function _chip(u) {
  if (!u) return '<span class="rv-none">not labeled</span>';
  return `<span class="rv-chip" style="background:${_cls(u.code)?.color || '#888'}"></span>${_esc(u.label || _cls(u.code)?.label || u.code)}`;
}

function _annotationsOf(r) {
  if (!r) return {};
  return r.annotations ?? (r.notes != null ? { notes: r.notes } : {});
}

function _blank(v) {
  return v == null || String(v).trim() === '';
}

// A stored result's units as {idx: {code, label}}
function _unitMap(r) {
  const units = r?.cells || r?.subPoints || [];
  return Object.fromEntries(units.map(u => [u.idx, { code: u.code, label: u.label }]));
}

// "Forest 5/9": the row's class and how many units back it.
function _summary(units, total, code, label) {
  if (code == null) return '<span class="rv-none">—</span>';
  const n = Object.values(units).filter(u => String(u.code) === String(code)).length;
  // Only the class name shrinks when space is tight; the count always shows.
  return `<span class="rv-chip" style="background:${_cls(code)?.color || '#888'}"></span>` +
         `<span class="rv-sum-label" title="${_esc(label)}">${_esc(label || _cls(code)?.label || code)}</span>` +
         `<b>${n}/${total}</b>`;
}

const RESOLVED_TEXT = {
  consensus: 'Consensus (A = B)',
  A:         'Accepted A',
  B:         'Accepted B',
  reviewer:  'Relabeled by reviewer',
};

export function renderCompareCard(plot) {
  const card = $('reviewCompareCard');
  if (!card) return;
  if (!isReviewProject() || !plot) { card.innerHTML = ''; return; }

  const item  = reviewItem(plot.id) || { status: 'missing_both' };
  const A = item.A, B = item.B;
  const meta  = STATUS[item.status] || STATUS.missing_both;
  const saved = state.project.results?.[plot.id];
  const multi = state.assessmentMode === 'pixel' || state.assessmentMode === 'grid';

  // A / B / Final unit maps. Point mode is one "unit" per row.
  let rows;
  if (multi) {
    const finalUnits = state.subPointResults[plot.id] || {};
    const agg = window.app?.computePlotLabel?.(plot.id);
    rows = [
      { key: 'A', name: `A · ${labelerName('A')}`, units: _unitMap(A), code: A?.code, label: A?.label },
      { key: 'B', name: `B · ${labelerName('B')}`, units: _unitMap(B), code: B?.code, label: B?.label },
      { key: 'F', name: 'Final', units: finalUnits, code: agg?.code, label: agg?.label },
    ];
  } else {
    const picked = _cls(state.selectedClass);
    const final  = picked ? { code: picked.code, label: picked.label } : (saved ? { code: saved.code, label: saved.label } : null);
    rows = [
      { key: 'A', name: `A · ${labelerName('A')}`, units: A ? { 0: A } : {} },
      { key: 'B', name: `B · ${labelerName('B')}`, units: B ? { 0: B } : {} },
      { key: 'F', name: 'Final', units: final ? { 0: final } : {} },
    ];
  }

  const gridN = parseInt(state.assessmentMode === 'grid' ? state.cellGrid : state.subPointGrid) || 3;
  const total = multi
    ? Math.max(gridN * gridN, ...rows.map(r => Math.max(-1, ...Object.keys(r.units).map(Number)) + 1))
    : 1;
  const sel = multi ? (state.selectedSubPointIdx ?? 0) : 0;
  const noun = state.assessmentMode === 'grid' ? 'Cell' : 'Sub-point';

  // Compared by an uploaded-file column: the column decides agree/disagree.
  // Pixel/grid mode keeps the full A / B / Final unit matrix (values shown in
  // the "Compared by" line); point mode shows each value and the class it names.
  const compareBy = state.review?.compareBy || null;
  const valueHtml = key => {
    const v = item[`value${key}`];
    if (v == null) return '<span class="rv-none">no value</span>';
    const c = _cls(item[`class${key}`]);
    return `<span class="rv-val">${_esc(v)}</span>` +
      (c ? ` → ${_chip({ code: c.code, label: c.label })}` : ' <span class="rv-none">(no class)</span>');
  };

  const matrix = rows.map(r => {
    if (compareBy && !multi && r.key !== 'F') {
      return `<div class="rv-mrow rv-value-row">
                <div class="rv-mname" title="${_esc(r.name)}">${_esc(r.name)}</div>
                <div class="rv-value">${valueHtml(r.key)}</div>
              </div>`;
    }
    const cells = multi
      ? Array.from({ length: total }, (_, i) => {
          const u = r.units[i];
          const color = u ? (_cls(u.code)?.color || '#888') : '#1c1f2b';
          // tabindex/mousedown: never take keyboard focus, so class hotkeys and
          // Enter keep acting on the review instead of on this button.
          return `<button class="rv-sq${i === sel ? ' sel' : ''}" style="background:${color}" tabindex="-1"
                    title="${noun} ${i + 1}: ${_esc(u?.label || 'not labeled')}"
                    onmousedown="event.preventDefault()" onclick="app.selectSubPoint(${i})"></button>`;
        }).join('')
      : _chip(r.units[0]);
    // Compared by a column: A / B rows end with that labeler's column value.
    const sum = !multi ? ''
      : compareBy && r.key !== 'F'
      ? `<span class="rv-sum"><b>${_esc(item[`value${r.key}`] ?? '–')}</b></span>`
      : `<span class="rv-sum">${_summary(r.units, total, r.code, r.label)}</span>`;
    return `<div class="rv-mrow${r.key === 'F' ? ' rv-final' : ''}">
              <div class="rv-mname" title="${_esc(r.name)}">${_esc(r.name)}</div>
              <div class="rv-squares">${cells}</div>${sum}
            </div>`;
  }).join('');

  // Selected unit: which class A, B and Final gave it. Colour first, in its
  // own column, so the three rows line up.
  const detailRow = (who, u) => `
    <div class="rv-detail-row">
      <span class="rv-chip" style="background:${u ? (_cls(u.code)?.color || '#888') : 'transparent'}"></span>
      <span class="rv-cls">${u ? _esc(u.label || _cls(u.code)?.label || u.code) : '<span class="rv-none">not labeled</span>'}</span>
      <span class="rv-who">${_esc(who)}</span>
    </div>`;
  const detail = multi ? `
    <div class="rv-detail">
      <div class="rv-detail-head">${noun} ${sel + 1}</div>
      ${rows.map(r => detailRow(r.key === 'F' ? 'Final' : `${r.key} · ${labelerName(r.key)}`, r.units[sel])).join('')}
    </div>` : '';

  const annA = _annotationsOf(A), annB = _annotationsOf(B);
  const notes = (state.project.annotationFields || [])
    .filter(f => !_blank(annA[f.key]) || !_blank(annB[f.key]))
    .map(f => `<div class="rv-note"><b>${_esc(f.label)}</b> — A: ${_esc(annA[f.key] || '–')} · B: ${_esc(annB[f.key] || '–')}</div>`)
    .join('');

  const note = multi && item.unitsComparable === false
    ? '<div class="rv-hint">A and B used different grids — only their classes are compared.</div>' : '';

  card.innerHTML = `
    <div class="rv-head">
      <span class="rv-badge rv-${meta[2]}" title="${meta[1]}">${meta[0]}</span>
      ${saved ? `<span class="rv-resolved">✓ ${_esc(RESOLVED_TEXT[saved.resolvedBy] || 'Resolved')}: ${_esc(saved.label)}</span>` : ''}
    </div>
    ${compareBy ? `<div class="rv-compare-by">Compared by column: <b>${_esc(compareBy)}</b></div>` : ''}
    <div class="rv-matrix">${matrix}</div>
    ${detail}
    ${notes}
    ${note}`;
}

// ── Create-review modal ───────────────────────────────────────────────────
export async function openCreateReviewModal() {
  let projects = [];
  try { projects = await api.listProjects(); } catch (_) {}
  const sources = projects.filter(p => p.type !== 'review');
  for (const side of ['A', 'B']) {
    const sel = $(`reviewSrc${side}`);
    sel.innerHTML = `<option value="">— upload a project file —</option>` +
      sources.map(p => `<option value="${_esc(p.id)}">${_esc(p.name)} (${p.completedCount}/${p.plotCount})</option>`).join('');
    $(`reviewFile${side}`).value = '';
    $(`reviewName${side}`).value = '';
  }
  $('reviewProjectName').value = '';
  $('reviewReviewer').value    = '';
  $('reviewPreview').innerHTML = '';
  _refreshCompareOptions();
  _reviewError('');
  $('createReviewModal').classList.remove('hidden');
}

export function closeCreateReviewModal() {
  $('createReviewModal').classList.add('hidden');
}

function _reviewError(msg) {
  const el = $('createReviewError');
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

function _reviewForm(dryRun) {
  const form = new FormData();
  for (const side of ['A', 'B']) {
    const file = $(`reviewFile${side}`).files[0];
    const id   = $(`reviewSrc${side}`).value;
    if (file)    form.append(`file${side}`, file);
    else if (id) form.append(`projectId${side}`, id);
    else throw new Error(`Choose labeler ${side}'s project (upload the exported JSON or pick one from the list).`);
    form.append(`name${side}`, $(`reviewName${side}`).value.trim());
  }
  form.append('name',     $('reviewProjectName').value.trim());
  form.append('reviewer', $('reviewReviewer').value.trim());
  form.append('compareBy', $('reviewCompareBy').value);
  if (dryRun) form.append('dryRun', '1');
  return form;
}

function _previewHtml({ stats: s, warnings }) {
  const kappa = s.kappa != null ? s.kappa.toFixed(2) : '–';
  return `
    <div class="rv-preview-stats">
      <div>Compared by <b>${_esc($('reviewCompareBy').selectedOptions[0]?.textContent || 'Final class')}</b></div>
      <div><b>${s.total}</b> plots · <b>${s.bothLabeled}</b> labeled by both</div>
      <div>Agree <b>${s.agree}</b> · units differ <b>${s.agreePartial}</b> · disagree <b>${s.disagree}</b></div>
      <div>Missing from A <b>${s.missingA}</b> · from B <b>${s.missingB}</b> · both <b>${s.missingBoth}</b></div>
      <div>Agreement <b>${s.agreementPct ?? '–'}%</b> · Cohen's κ <b>${kappa}</b></div>
    </div>
    ${warnings.length ? `<ul class="rv-preview-warn">${warnings.map(w => `<li>${_esc(w)}</li>`).join('')}</ul>` : ''}`;
}

export async function compareReviewSources() {
  _reviewError('');
  try {
    const res = await api.createReview(_reviewForm(true));
    $('reviewPreview').innerHTML = _previewHtml(res);
  } catch (e) { _reviewError(e.message); }
}

// Creates the review project; returns its id (null on error).
export async function submitCreateReview() {
  _reviewError('');
  try {
    const { id } = await api.createReview(_reviewForm(false));
    closeCreateReviewModal();
    return id;
  } catch (e) { _reviewError(e.message); return null; }
}

// Picking a file clears the dropdown for that side (and vice versa) so it is
// always clear which source will be used.
// (Called without arguments when only the "Compare by" choice changes.)
export function onReviewSourceChange(side, kind) {
  if (kind === 'file' && $(`reviewFile${side}`).files[0]) $(`reviewSrc${side}`).value = '';
  if (kind === 'select' && $(`reviewSrc${side}`).value)    $(`reviewFile${side}`).value = '';
  $('reviewPreview').innerHTML = '';
  if (side) _refreshCompareOptions();
}

// ── "Compare by" options: uploaded-file columns both projects share ──────
async function _readSource(side) {
  const file = $(`reviewFile${side}`).files[0];
  if (file) return JSON.parse(await file.text());
  const id = $(`reviewSrc${side}`).value;
  return id ? api.loadProject(id) : null;
}

function _metaKeys(proj) {
  const keys = new Set();
  for (const p of proj?.plots || []) for (const k of Object.keys(p.meta || {})) keys.add(k);
  return keys;
}

let _compareOptionsSeq = 0;
async function _refreshCompareOptions() {
  const sel  = $('reviewCompareBy');
  const hint = $('reviewCompareByHint');
  const keep = sel.value;
  const seq  = ++_compareOptionsSeq;   // ignore answers to superseded requests
  let shared = [];
  let msg = 'Pick both projects to list the uploaded-file columns they share.';
  try {
    const [a, b] = await Promise.all([_readSource('A'), _readSource('B')]);
    if (a && b) {
      const kb = _metaKeys(b);
      shared = [..._metaKeys(a)].filter(k => kb.has(k));
      msg = shared.length
        ? `${shared.length} uploaded-file column(s) found in both projects.`
        : 'The two projects share no uploaded-file columns — comparing the EarthLabel class.';
    }
  } catch (e) { msg = `Could not read a project: ${e.message}`; }
  if (seq !== _compareOptionsSeq) return;
  sel.innerHTML = `<option value="">Final class (EarthLabel label)</option>` +
    shared.map(k => `<option value="${_esc(k)}">Column: ${_esc(k)}</option>`).join('');
  sel.value = shared.includes(keep) ? keep : '';
  hint.textContent = msg;
}
