// Floating NDVI panel — monthly Sentinel-2 NDVI for the current plot,
// with an editable per-project class reference table.
//
// All NDVI cache lives inside state.project.ndviCache, keyed by plotId,
// and is persisted server-side. Reference ranges and seasonal-pattern
// descriptions live on each class in state.project.classSchema.
// The panel is opt-in: with state.ndviPanelOpen false, this module
// performs no network work.

import { state, setState } from './state.js';
import * as api from './api.js';

const $ = (id) => document.getElementById(id);

const FIRST_YEAR = 2017;
const DEFAULT_YEAR = Math.max(FIRST_YEAR, new Date().getFullYear() - 1);
const LINE_CHART_SVG =
  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M3 21V3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
  '<path d="M3 21H21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
  '<path d="M5 16 L9 11 L13 14 L17 7 L21 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<circle cx="9" cy="11" r="1.4" fill="currentColor"/>' +
  '<circle cx="13" cy="14" r="1.4" fill="currentColor"/>' +
  '<circle cx="17" cy="7" r="1.4" fill="currentColor"/>' +
  '</svg>';

let chart = null;          // Chart.js instance
let currentPlotId = null;  // plot whose data the panel is currently showing
let currentYear = Number(localStorage.getItem('ndviPanelYear')) || DEFAULT_YEAR;
let initialized = false;

// Auto-fetch state (Change 3): when the panel is open, navigating to an
// uncached plot triggers a fetch automatically. To avoid blasting the user
// with credential errors, the first auth failure disables auto-fetch for the
// session; a successful manual fetch re-enables it. `inFlightKeys` prevents
// duplicate concurrent fetches for the same (plotId, year).
let autoFetchDisabled = false;
const inFlightKeys = new Set();
const inFlightKey = (plotId, year) => `${plotId}|${year}`;

// label → { ndviRange, seasonalPattern } fallback used when a project's stored
// classSchema predates the seeded defaults. Built lazily by scanning every
// built-in preset on first use, so existing projects get sensible suggestions
// without a migration. We also keep the full preset records keyed by id so the
// guide can detect which scheme a project uses and look up authoritative
// per-class defaults for the row-reset button.
let defaultsByLabel = null;
let presetsById     = null;     // { id: { id, name, classes } } — built-ins only
let defaultsPromise = null;
const schemeDetectionCache = new Map();  // projectId → presetId | null

async function loadDefaultsByLabel() {
  if (defaultsByLabel) return defaultsByLabel;
  if (defaultsPromise) return defaultsPromise;
  defaultsPromise = (async () => {
    const map  = {};
    const byId = {};
    const presets = state.presets || [];
    // Prefer MOLCA last so its values win for shared labels (Forest, Cropland, ...).
    const order = presets.filter(p => p.id !== 'molca').concat(presets.filter(p => p.id === 'molca'));
    for (const p of order) {
      if (p.user) continue;                  // built-ins only
      try {
        const full = await api.getPreset(p.id);
        byId[p.id] = { id: p.id, name: full.name || p.name, classes: full.classes || [] };
        for (const c of (full.classes || [])) {
          const key = String(c.label || '').trim().toLowerCase();
          if (!key) continue;
          if (Array.isArray(c.ndviRange) || c.seasonalPattern) {
            map[key] = {
              ndviRange: Array.isArray(c.ndviRange) ? c.ndviRange : map[key]?.ndviRange,
              seasonalPattern: c.seasonalPattern || map[key]?.seasonalPattern || '',
            };
          }
        }
      } catch (_) {}
    }
    defaultsByLabel = map;
    presetsById     = byId;
    return map;
  })();
  return defaultsPromise;
}

function lookupDefault(label) {
  if (!defaultsByLabel || !label) return null;
  return defaultsByLabel[String(label).trim().toLowerCase()] || null;
}

// Detect which built-in preset a project's classSchema came from by computing
// the overlap on (code, label). Returns the preset object or null for Custom.
// Cached per project id since classSchema is rarely re-loaded mid-session.
function detectScheme(project) {
  if (!project || !Array.isArray(project.classSchema) || !presetsById) return null;
  if (schemeDetectionCache.has(project.id)) {
    const id = schemeDetectionCache.get(project.id);
    return id ? presetsById[id] : null;
  }
  const schema = project.classSchema;
  if (!schema.length) {
    schemeDetectionCache.set(project.id, null);
    return null;
  }

  let bestId = null, bestRatio = 0;
  for (const [id, p] of Object.entries(presetsById)) {
    if (id === 'custom') continue;
    const presetByCode = new Map();
    for (const c of p.classes) presetByCode.set(String(c.code), String(c.label || '').toLowerCase());
    let matched = 0;
    for (const c of schema) {
      const expected = presetByCode.get(String(c.code));
      if (expected && expected === String(c.label || '').toLowerCase()) matched++;
    }
    const ratio = matched / schema.length;
    if (ratio > bestRatio) { bestRatio = ratio; bestId = id; }
  }
  const winnerId = bestRatio >= 0.6 ? bestId : null;
  schemeDetectionCache.set(project.id, winnerId);
  return winnerId ? presetsById[winnerId] : null;
}

// Strip the parenthetical class count from a preset name for display:
// "MOLCA 2019 (10 classes)" → "MOLCA 2019".
function schemeDisplayName(preset) {
  if (!preset) return null;
  return String(preset.name || '').replace(/\s*\([^)]*classes?\)\s*$/i, '').trim();
}

// ── Panel visibility ──────────────────────────────────────────────────────
export function openNdviPanel() {
  setState({ ndviPanelOpen: true });
  $('ndviPanel').classList.remove('hidden');
  $('btn-ndvi')?.classList.add('active');
  hydratePosition();
  hydrateSize();
  // hydrateGuideOpen() calls setGuideOpen() which applies split + col widths
  // only when the guide is actually visible — so the chart fills the panel
  // when the guide is closed.
  hydrateGuideOpen();
  renderForCurrentPlot();
}

export function closeNdviPanel() {
  setState({ ndviPanelOpen: false });
  $('ndviPanel').classList.add('hidden');
  $('btn-ndvi')?.classList.remove('active');
}

export function toggleNdviPanel() {
  if (state.ndviPanelOpen) closeNdviPanel();
  else                     openNdviPanel();
}

// ── Position + size persistence ───────────────────────────────────────────
function hydratePosition() {
  const panel = $('ndviPanel');
  if (!panel) return;
  try {
    const saved = JSON.parse(localStorage.getItem('ndviPanelPos') || 'null');
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      const maxLeft = window.innerWidth - panel.offsetWidth - 8;
      const maxTop  = window.innerHeight - panel.offsetHeight - 8;
      panel.style.left   = Math.max(8, Math.min(saved.left, maxLeft)) + 'px';
      panel.style.top    = Math.max(8, Math.min(saved.top,  maxTop))  + 'px';
      panel.style.right  = 'auto';
      panel.style.bottom = 'auto';
    }
  } catch (_) {}
}

// The panel has two natural sizes: a compact square when only the NDVI
// chart is showing, and a wider rectangle when the guide column is open.
// We persist each separately so reopening restores whichever mode the user
// was last in, at their last-resized size.
const DEFAULT_SIZE_CLOSED = { width: 540, height: 540 };
const DEFAULT_SIZE_OPEN   = { width: 880, height: 540 };
const MIN_WIDTH_CLOSED = 320;
const MIN_WIDTH_OPEN   = 520;
const MIN_HEIGHT = 280;
// Geometry shared with the CSS: .ndvi-body has padding 12px 14px (28px
// horizontal total); .ndvi-split-handle has flex:0 0 4px plus 2px margin
// on each side (8px visible footprint). Used to convert between figure
// width and panel width so toggling the guide snaps to the pinned figure.
const BODY_H_PAD = 28;
const SPLIT_HANDLE_W = 8;
const MIN_RIGHT_PX = 220;

// Callers can pass `opts.width`/`opts.height` to override the persisted
// value. setGuideOpen() does this so the panel snaps to a size derived from
// the currently pinned figure width — a stale saved width from a different
// figure size would force the figure to reflow.
function applyPanelSize(open, opts = {}) {
  const panel = $('ndviPanel');
  if (!panel) return;
  let targetW = opts.width;
  let targetH = opts.height;
  if (targetW == null || targetH == null) {
    const key = open ? 'ndviPanelSizeOpen' : 'ndviPanelSizeClosed';
    const fallback = open ? DEFAULT_SIZE_OPEN : DEFAULT_SIZE_CLOSED;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) {}
    if (targetW == null) targetW = saved?.width  || fallback.width;
    if (targetH == null) targetH = saved?.height || fallback.height;
  }
  const minW = open ? MIN_WIDTH_OPEN : MIN_WIDTH_CLOSED;
  const newW = Math.max(minW,       Math.min(targetW, window.innerWidth  - 16));
  const newH = Math.max(MIN_HEIGHT, Math.min(targetH, window.innerHeight - 16));

  // Anchor by left edge so toggling the guide extends/collapses the RIGHT
  // edge while the figure (left column) stays put. If the panel is still
  // anchored by the CSS default (right:24px; bottom:24px), promote it to
  // explicit inline left/top first so width changes don't move the figure.
  const r = panel.getBoundingClientRect();
  const hasInlineLeft = panel.style.left && panel.style.left !== 'auto';
  if (!hasInlineLeft) {
    panel.style.left   = r.left + 'px';
    panel.style.top    = r.top  + 'px';
    panel.style.right  = 'auto';
    panel.style.bottom = 'auto';
  }
  panel.style.width  = newW + 'px';
  panel.style.height = newH + 'px';
}

function persistPanelSize(open) {
  const panel = $('ndviPanel');
  if (!panel) return;
  const r = panel.getBoundingClientRect();
  const key = open ? 'ndviPanelSizeOpen' : 'ndviPanelSizeClosed';
  localStorage.setItem(key, JSON.stringify({ width: r.width, height: r.height }));
  // When closed, the figure fills the body — capture its width so the next
  // guide-open uses the same locked figure size.
  if (!open) {
    const left = document.querySelector('.ndvi-left');
    if (left) {
      const figW = Math.round(left.getBoundingClientRect().width);
      if (figW > 0) localStorage.setItem('ndviFigureWidth', String(figW));
    }
  }
}

function hydrateSize() {
  // No-op default; setGuideOpen() applies the size for the current mode.
}

// ── Split (chart | guide) drag ────────────────────────────────────────────
// The figure (left column) is pinned at a fixed pixel width, so dragging the
// split bar resizes the GUIDE (right) column by growing/shrinking the whole
// panel — the panel's left edge stays put, only its right edge moves. The
// new panel width is persisted via the normal ndviPanelSizeOpen slot.
function initSplit() {
  const handle = $('ndviSplitHandle');
  const panel  = $('ndviPanel');
  if (!handle || !panel) return;
  let dragging = false, startX = 0, startPanelW = 0;

  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    startPanelW = panel.getBoundingClientRect().width;
    handle.classList.add('active');
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const left = document.querySelector('.ndvi-left');
    const figW = left ? left.getBoundingClientRect().width : 0;
    // Floor the new panel width so the right column never collapses below
    // its minimum: figure + split handle + min right + body padding.
    const minPanelW = figW + SPLIT_HANDLE_W + MIN_RIGHT_PX + BODY_H_PAD;
    const newW = Math.max(minPanelW, startPanelW + dx);
    panel.style.width = newW + 'px';
    if (chart) chart.resize();
  });
  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('active');
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
    const r = panel.getBoundingClientRect();
    localStorage.setItem('ndviPanelSizeOpen', JSON.stringify({ width: r.width, height: r.height }));
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}

// ── Guide column widths persistence + drag ────────────────────────────────
// With `table-layout:fixed`, the table honours the per-column widths only if
// all three are set explicitly. The pattern column gets an explicit width too
// (not 'auto') so dragging the class or range column actually shifts space.
const DEFAULT_COL_WIDTHS = { class: 120, range: 140, pattern: 240 };
const MIN_COL_WIDTHS     = { class: 90,  range: 130, pattern: 120 };

function applyColWidths(widths) {
  const table = $('ndviGuideTable');
  if (!table) return;
  const cClass = table.querySelector('col.ndvi-col-class');
  const cRange = table.querySelector('col.ndvi-col-range');
  const cPat   = table.querySelector('col.ndvi-col-pattern');
  if (cClass) cClass.style.width = `${Math.max(MIN_COL_WIDTHS.class,   widths.class)}px`;
  if (cRange) cRange.style.width = `${Math.max(MIN_COL_WIDTHS.range,   widths.range)}px`;
  if (cPat)   cPat.style.width   = `${Math.max(MIN_COL_WIDTHS.pattern, widths.pattern)}px`;
}

function hydrateColWidths() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('ndviGuideCols') || 'null'); } catch (_) {}
  const widths = {
    class:   Number.isFinite(saved?.class)   ? saved.class   : DEFAULT_COL_WIDTHS.class,
    range:   Number.isFinite(saved?.range)   ? saved.range   : DEFAULT_COL_WIDTHS.range,
    pattern: Number.isFinite(saved?.pattern) ? saved.pattern : DEFAULT_COL_WIDTHS.pattern,
  };
  applyColWidths(widths);
}

function initColResize() {
  const table = $('ndviGuideTable');
  if (!table) return;
  // Every column except the last gets a draggable right-edge grip. Each grip
  // adjusts its own column width and is otherwise independent — the pattern
  // column simply absorbs the table-width change.
  for (const grip of table.querySelectorAll('.ndvi-col-resize')) {
    const colName = grip.dataset.col;             // 'class' or 'range'
    const colEl = table.querySelector(`col.ndvi-col-${colName}`);
    if (!colEl) continue;
    let dragging = false, startX = 0, startW = 0;
    grip.addEventListener('pointerdown', (e) => {
      dragging = true;
      startX = e.clientX;
      startW = parseFloat(colEl.style.width) || colEl.getBoundingClientRect().width;
      grip.classList.add('active');
      grip.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const min = MIN_COL_WIDTHS[colName] || 60;
      const w = Math.max(min, startW + (e.clientX - startX));
      colEl.style.width = `${w}px`;
    });
    const stop = (e) => {
      if (!dragging) return;
      dragging = false;
      grip.classList.remove('active');
      try { grip.releasePointerCapture(e.pointerId); } catch (_) {}
      const widths = {
        class:   parseFloat(table.querySelector('col.ndvi-col-class')?.style.width)   || DEFAULT_COL_WIDTHS.class,
        range:   parseFloat(table.querySelector('col.ndvi-col-range')?.style.width)   || DEFAULT_COL_WIDTHS.range,
        pattern: parseFloat(table.querySelector('col.ndvi-col-pattern')?.style.width) || DEFAULT_COL_WIDTHS.pattern,
      };
      localStorage.setItem('ndviGuideCols', JSON.stringify(widths));
    };
    grip.addEventListener('pointerup', stop);
    grip.addEventListener('pointercancel', stop);
  }
}

// ── Guide visibility (toggled by the triangle button in .ndvi-left) ──────
// Default: hidden — the panel opens showing only the NDVI curve. The button
// reveals the divider + right column when clicked. The figure (left column)
// is pinned to a fixed pixel width across toggles so opening or closing the
// guide only moves the panel's RIGHT edge — the figure's size and position
// stay put.
// Pending close cleanup (transitionend listener + timeout). Cancelled if the
// user re-opens the guide before the close animation finishes — otherwise the
// deferred un-pin would wipe the freshly-pinned figure.
let pendingCloseCleanup = null;

function setGuideOpen(open) {
  const panel = $('ndviPanel');
  const body  = document.querySelector('.ndvi-body');
  const left  = document.querySelector('.ndvi-left');
  const btn   = $('ndviGuideToggleBtn');
  if (!body || !panel) return;

  if (pendingCloseCleanup) { pendingCloseCleanup.cancel(); pendingCloseCleanup = null; }

  // Snapshot the figure's current rendered width BEFORE mutating classes.
  // When the guide is currently closed, .ndvi-left { flex:1 } makes the
  // figure equal to the body's inner width; that's the width we want to
  // freeze. When already open we re-use the existing inline px basis.
  const figW = left ? Math.round(left.getBoundingClientRect().width) : 0;

  btn?.classList.toggle('active', !!open);
  localStorage.setItem('ndviGuideOpen', open ? '1' : '0');

  if (open) {
    // Pin figure width BEFORE revealing the right column so the layout
    // doesn't briefly split the body 50/50 between left and right flex:1.
    if (left && figW > 0) {
      left.style.flex = `0 0 ${figW}px`;
      localStorage.setItem('ndviFigureWidth', String(figW));
    }
    body.classList.add('guide-open');
    panel.classList.add('guide-open');
    // First-open rule: guide column starts at least as wide as the figure.
    // After that, prefer the user's last resized width (saved via the split
    // handle or edge resize), so subsequent toggles restore their choice.
    let savedOpen = null;
    try { savedOpen = JSON.parse(localStorage.getItem('ndviPanelSizeOpen') || 'null'); } catch (_) {}
    const savedGuideW = savedOpen
      ? savedOpen.width - (figW + SPLIT_HANDLE_W + BODY_H_PAD)
      : null;
    const guideW = Math.max(MIN_RIGHT_PX, figW, savedGuideW ?? figW);
    // Keep the panel's current height so the toggle is width-only — using a
    // persisted height from a different mode would cause a vertical jump.
    const curH = panel.getBoundingClientRect().height;
    applyPanelSize(true, { width: figW + SPLIT_HANDLE_W + guideW + BODY_H_PAD, height: curH });
    hydrateColWidths();
    renderGuideTable();
    if (chart) chart.resize();
  } else {
    // Close path: the panel CSS has `transition: width .2s ease-out`, so
    // shrinking the panel and immediately releasing the figure's pinned width
    // would un-pin the figure mid-animation and let it stretch to fill the
    // mid-animation body — visible as a flash. Instead keep the figure pinned
    // and .guide-open on through the animation, and release them on
    // transitionend (with a timeout fallback in case the transition is
    // skipped, e.g. when reduced-motion is on).
    const cleanup = () => {
      body.classList.remove('guide-open');
      panel.classList.remove('guide-open');
      if (left) left.style.flex = '';
      if (chart) chart.resize();
    };
    const onEnd = (ev) => {
      if (ev.target !== panel || ev.propertyName !== 'width') return;
      panel.removeEventListener('transitionend', onEnd);
      clearTimeout(fallback);
      pendingCloseCleanup = null;
      cleanup();
    };
    panel.addEventListener('transitionend', onEnd);
    const fallback = setTimeout(() => {
      panel.removeEventListener('transitionend', onEnd);
      pendingCloseCleanup = null;
      cleanup();
    }, 350);
    pendingCloseCleanup = {
      cancel() {
        panel.removeEventListener('transitionend', onEnd);
        clearTimeout(fallback);
      },
    };
    // Width-only toggle: preserve current height (see open branch).
    const curH = panel.getBoundingClientRect().height;
    applyPanelSize(false, { width: figW + BODY_H_PAD, height: curH });
  }
}

export function toggleNdviGuide() {
  const body = document.querySelector('.ndvi-body');
  setGuideOpen(!body?.classList.contains('guide-open'));
}

function hydrateGuideOpen() {
  // Default: closed. Honour saved state if present.
  const saved = localStorage.getItem('ndviGuideOpen');
  setGuideOpen(saved === '1');
}

function initDrag() {
  const panel = $('ndviPanel');
  const handle = $('ndviHeader');
  if (!panel || !handle) return;
  let dragging = false, offX = 0, offY = 0;

  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, select, input')) return;
    dragging = true;
    const r = panel.getBoundingClientRect();
    offX = e.clientX - r.left;
    offY = e.clientY - r.top;
    panel.style.left   = r.left + 'px';
    panel.style.top    = r.top  + 'px';
    panel.style.right  = 'auto';
    panel.style.bottom = 'auto';
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const maxLeft = window.innerWidth  - panel.offsetWidth  - 8;
    const maxTop  = window.innerHeight - panel.offsetHeight - 8;
    const left = Math.max(8, Math.min(e.clientX - offX, maxLeft));
    const top  = Math.max(8, Math.min(e.clientY - offY, maxTop));
    panel.style.left = left + 'px';
    panel.style.top  = top  + 'px';
  });
  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
    const r = panel.getBoundingClientRect();
    localStorage.setItem('ndviPanelPos', JSON.stringify({ left: r.left, top: r.top }));
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}

function initResize() {
  const panel = $('ndviPanel');
  if (!panel) return;
  const MIN_W = 320, MIN_H = 280, MARGIN = 8;

  // One driver, eight zones. Each zone advertises its direction via
  // data-resize. The math handles edges that move the panel anchor (n / w)
  // as well as those that don't (s / e), plus the four corner combinations.
  for (const zone of panel.querySelectorAll('[data-resize]')) {
    let resizing = false;
    let dir = '';
    let startX = 0, startY = 0;
    let startW = 0, startH = 0;
    let startLeft = 0, startTop = 0;

    zone.addEventListener('pointerdown', (e) => {
      resizing = true;
      dir = zone.dataset.resize;
      const r = panel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startW = r.width;   startH = r.height;
      startLeft = r.left; startTop = r.top;
      // Lock the panel into left/top so resizing doesn't fight bottom/right.
      panel.style.left   = startLeft + 'px';
      panel.style.top    = startTop  + 'px';
      panel.style.right  = 'auto';
      panel.style.bottom = 'auto';
      zone.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    zone.addEventListener('pointermove', (e) => {
      if (!resizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let newW = startW, newH = startH, newLeft = startLeft, newTop = startTop;

      // Horizontal
      if (dir.includes('e')) {
        const maxW = window.innerWidth - startLeft - MARGIN;
        newW = Math.max(MIN_W, Math.min(startW + dx, maxW));
      } else if (dir.includes('w')) {
        // Moving the west edge: width shrinks/grows opposite to dx, anchor follows.
        const maxLeftShift = startW - MIN_W;
        const minLeftShift = -(startLeft - MARGIN);
        const shift = Math.max(minLeftShift, Math.min(dx, maxLeftShift));
        newLeft = startLeft + shift;
        newW   = startW - shift;
      }

      // Vertical
      if (dir.includes('s')) {
        const maxH = window.innerHeight - startTop - MARGIN;
        newH = Math.max(MIN_H, Math.min(startH + dy, maxH));
      } else if (dir.includes('n')) {
        const maxTopShift = startH - MIN_H;
        const minTopShift = -(startTop - MARGIN);
        const shift = Math.max(minTopShift, Math.min(dy, maxTopShift));
        newTop = startTop + shift;
        newH  = startH - shift;
      }

      panel.style.width  = newW    + 'px';
      panel.style.height = newH    + 'px';
      panel.style.left   = newLeft + 'px';
      panel.style.top    = newTop  + 'px';
      if (chart) chart.resize();
    });

    const stop = (e) => {
      if (!resizing) return;
      resizing = false;
      try { zone.releasePointerCapture(e.pointerId); } catch (_) {}
      const r = panel.getBoundingClientRect();
      // Persist into the closed-vs-open size slot so each mode remembers
      // its own dimensions independently.
      persistPanelSize(state.ndviPanelOpen && document.querySelector('.ndvi-body.guide-open') != null);
      localStorage.setItem('ndviPanelPos',  JSON.stringify({ left:  r.left,  top:    r.top }));
    };
    zone.addEventListener('pointerup', stop);
    zone.addEventListener('pointercancel', stop);
  }
}

// ── Year select ───────────────────────────────────────────────────────────
function populateYearSelect() {
  const sel = $('ndviYear');
  if (!sel) return;
  const now = new Date().getFullYear();
  sel.innerHTML = '';
  for (let y = now; y >= FIRST_YEAR; y--) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    sel.appendChild(opt);
  }
  sel.value = String(currentYear);
}

export function onNdviYearChange() {
  const sel = $('ndviYear');
  const y = Number(sel?.value) || DEFAULT_YEAR;
  currentYear = y;
  localStorage.setItem('ndviPanelYear', String(y));
  renderForCurrentPlot();
}

// ── Render current plot ───────────────────────────────────────────────────
function currentPlot() {
  return state.plots[state.currentIndex];
}

export function renderForCurrentPlot() {
  if (!state.ndviPanelOpen) return;
  const plot = currentPlot();
  currentPlotId = plot?.id ?? null;

  const status     = $('ndviStatus');
  const fetchBtn   = $('ndviFetchBtn');
  const refreshBtn = $('ndviRefreshBtn');
  const chartWrap  = document.querySelector('.ndvi-chart-wrap');

  if (!plot) {
    status.textContent = 'Open a plot to begin.';
    status.className = 'ndvi-status';
    fetchBtn.disabled = true;
    refreshBtn.disabled = true;
    chartWrap?.classList.add('empty');
    destroyChart();
    renderGuideTable();
    return;
  }

  fetchBtn.disabled   = false;
  refreshBtn.disabled = false;

  const cache = state.project?.ndviCache?.[plot.id];
  const cacheMatchesYear = cache && (cache.year ?? DEFAULT_YEAR) === currentYear;

  if (cacheMatchesYear && Array.isArray(cache.months)) {
    status.textContent = `Plot #${plot.id} · ${currentYear} · cached ${formatRelative(cache.fetchedAt)}`;
    status.className = 'ndvi-status';
    chartWrap?.classList.remove('empty');
    renderChart(cache.months);
  } else if (cache) {
    status.textContent = `Plot #${plot.id} · ${currentYear} · no cache for this year (cached: ${cache.year}). Click Fetch.`;
    status.className = 'ndvi-status';
    chartWrap?.classList.add('empty');
    destroyChart();
  } else {
    status.textContent = `Plot #${plot.id} · ${currentYear} · no data yet. Click Fetch to query Sentinel Hub.`;
    status.className = 'ndvi-status';
    chartWrap?.classList.add('empty');
    destroyChart();
  }

  renderGuideTable();

  // Auto-fetch when the panel is open and this plot+year has no cache yet.
  // Skipped after a credentials error to avoid spamming on every navigation.
  if (!cacheMatchesYear && !autoFetchDisabled
      && !inFlightKeys.has(inFlightKey(plot.id, currentYear))) {
    doFetch({ forceRefresh: false, auto: true });
  }
}

function formatRelative(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)        return 'just now';
  if (ms < 3_600_000)     return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000)    return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Interpretation guide table (per-project class reference) ──────────────
function renderGuideTable() {
  const table = $('ndviGuideTable');
  const tbody = table?.querySelector('tbody');
  if (!tbody) return;
  const plot   = currentPlot();
  const plotCode = plot ? String(plot.refCode) : null;
  const schema = state.project?.classSchema || [];

  // Scheme-aware header: rewrite the "Class" <th> and the <summary>
  // text so the user knows which legend they're editing.
  const scheme = detectScheme(state.project);
  const schemeName = schemeDisplayName(scheme);
  const headerCell = table?.querySelector('thead th:first-child');
  if (headerCell) {
    headerCell.textContent = schemeName ? `${schemeName} Class` : 'Class (custom)';
    headerCell.classList.add('scheme-name');
  }
  const summary = document.querySelector('.ndvi-guide > summary');
  if (summary) {
    summary.textContent = schemeName
      ? `Interpretation guide — ${schemeName} class reference`
      : 'Interpretation guide — class reference';
  }

  // Build a code→preset-class map so per-row reset can look up defaults.
  const presetByCode = new Map();
  if (scheme) for (const pc of scheme.classes) presetByCode.set(String(pc.code), pc);

  tbody.innerHTML = '';

  if (!schema.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-dim);font-style:italic;">No classes defined for this project.</td></tr>';
    return;
  }

  for (const c of schema) {
    const tr = document.createElement('tr');
    tr.dataset.code = String(c.code);
    if (plotCode != null && String(c.code) === plotCode) tr.classList.add('current');

    // Fallback to label-matched defaults when this project's classSchema
    // predates the seeded ndviRange / seasonalPattern fields.
    const fallback = lookupDefault(c.label);
    const range   = Array.isArray(c.ndviRange) ? c.ndviRange : (fallback?.ndviRange || null);
    const pattern = c.seasonalPattern || fallback?.seasonalPattern || '';
    const isFallback = !Array.isArray(c.ndviRange) && Array.isArray(fallback?.ndviRange);
    if (isFallback) tr.classList.add('suggested');

    const minVal = range ? Number(range[0]) : '';
    const maxVal = range ? Number(range[1]) : '';
    const safeLabel = escapeHtml(c.label || '');
    const safePattern = escapeHtml(pattern);
    tr.innerHTML = `
      <td><span class="class-dot" style="background:${c.color || '#888'}"></span>${safeLabel}</td>
      <td class="ndvi-range-cell">
        <input type="text" inputmode="decimal" data-field="min" value="${minVal}">
        <span class="sep">–</span>
        <input type="text" inputmode="decimal" data-field="max" value="${maxVal}">
      </td>
      <td class="ndvi-pattern-cell">
        <input type="text" data-field="pattern" value="${safePattern}" placeholder="e.g. consistently high, almost flat">
      </td>`;
    tbody.appendChild(tr);
  }
}

// Single "Reset all to defaults" button (in the guide actions row). Reverts
// every row's three inputs to the detected scheme's seeded defaults. Does not
// auto-save — the user clicks Save guide to persist (same flow as today).
export function resetNdviGuide() {
  if (!state.project) return;
  const scheme = detectScheme(state.project);
  if (!scheme) {
    setGuideMsg('No scheme default available for this custom schema.', 'error');
    return;
  }
  const tbody = $('ndviGuideTable')?.querySelector('tbody');
  if (!tbody) return;
  const presetByCode = new Map();
  for (const pc of scheme.classes) presetByCode.set(String(pc.code), pc);

  for (const tr of tbody.querySelectorAll('tr[data-code]')) {
    const presetCls = presetByCode.get(tr.dataset.code);
    if (!presetCls) continue;
    const minIn = tr.querySelector('input[data-field="min"]');
    const maxIn = tr.querySelector('input[data-field="max"]');
    const patIn = tr.querySelector('input[data-field="pattern"]');
    if (Array.isArray(presetCls.ndviRange)) {
      if (minIn) minIn.value = Number(presetCls.ndviRange[0]);
      if (maxIn) maxIn.value = Number(presetCls.ndviRange[1]);
    } else {
      if (minIn) minIn.value = '';
      if (maxIn) maxIn.value = '';
    }
    if (patIn) patIn.value = presetCls.seasonalPattern || '';
    tr.classList.add('suggested');
  }
  setGuideMsg(`Reset to ${schemeDisplayName(scheme)} defaults. Click Save guide to persist.`, '');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function saveNdviGuide() {
  if (!state.project) return;
  const tbody = $('ndviGuideTable')?.querySelector('tbody');
  if (!tbody) return;

  const edits = {};
  for (const tr of tbody.querySelectorAll('tr[data-code]')) {
    const code = tr.dataset.code;
    const minIn  = tr.querySelector('input[data-field="min"]');
    const maxIn  = tr.querySelector('input[data-field="max"]');
    const patIn  = tr.querySelector('input[data-field="pattern"]');
    const minRaw = minIn?.value.trim() ?? '';
    const maxRaw = maxIn?.value.trim() ?? '';
    const min = minRaw === '' ? null : Number(minRaw);
    const max = maxRaw === '' ? null : Number(maxRaw);

    if ((minRaw !== '' && !Number.isFinite(min)) || (maxRaw !== '' && !Number.isFinite(max))) {
      setGuideMsg(`Row "${code}": NDVI values must be numbers between -1 and 1.`, 'error');
      return;
    }
    if (min != null && max != null && min >= max) {
      setGuideMsg(`Row "${code}": min must be less than max.`, 'error');
      return;
    }

    const ndviRange = (min == null && max == null) ? undefined : [min ?? 0, max ?? 0];
    edits[code] = { ndviRange, seasonalPattern: patIn?.value ?? '' };
  }

  const newSchema = (state.project.classSchema || []).map(c => {
    const e = edits[String(c.code)];
    if (!e) return c;
    const next = { ...c, seasonalPattern: e.seasonalPattern };
    if (e.ndviRange) next.ndviRange = e.ndviRange;
    else             delete next.ndviRange;
    return next;
  });

  setState({ project: { ...state.project, classSchema: newSchema } });
  try {
    await api.saveClassSchema(state.project.id, newSchema);
    setGuideMsg('Saved.', 'ok');
  } catch (e) {
    setGuideMsg(`Save failed: ${e.message}`, 'error');
    return;
  }
  // Re-render so the chart's reference band picks up the new range and the
  // guide table loses its 'suggested' (italic-grey) styling on the saved rows.
  renderGuideTable();
  const plot = currentPlot();
  const cache = plot && state.project?.ndviCache?.[plot.id];
  if (cache?.months && (cache.year ?? DEFAULT_YEAR) === currentYear) {
    renderChart(cache.months);
  }
}

function setGuideMsg(msg, kind) {
  const el = $('ndviGuideMsg');
  if (!el) return;
  el.textContent = msg;
  el.className = `ndvi-guide-msg${kind ? ' ' + kind : ''}`;
  if (kind === 'ok') setTimeout(() => { if (el.textContent === 'Saved.') el.textContent = ''; }, 2500);
}

function setStatus(msg, kind) {
  const el = $('ndviStatus');
  el.textContent = msg;
  el.className = `ndvi-status${kind ? ' ' + kind : ''}`;
}

// ── Fetch ─────────────────────────────────────────────────────────────────
async function doFetch({ forceRefresh, auto } = {}) {
  const plot = currentPlot();
  if (!plot || !state.project) return;
  const fetchPlotId = plot.id;
  const fetchYear = currentYear;
  const lat = plot.lat, lon = plot.lon;
  const projectId = state.project.id;

  const cached = state.project?.ndviCache?.[fetchPlotId];
  if (!forceRefresh && cached && (cached.year ?? DEFAULT_YEAR) === fetchYear) {
    return;
  }

  // De-dupe concurrent fetches for the same (plot, year). Allows rapid
  // navigation through uncached plots without piling up duplicate requests.
  const key = inFlightKey(fetchPlotId, fetchYear);
  if (inFlightKeys.has(key)) return;
  inFlightKeys.add(key);

  const isCurrent = () => currentPlotId === fetchPlotId && currentYear === fetchYear;
  if (isCurrent()) {
    setStatus(`Fetching Sentinel-2 NDVI for plot #${fetchPlotId} (${fetchYear})…`, '');
    $('ndviFetchBtn').disabled = true;
    $('ndviRefreshBtn').disabled = true;
  }

  let response;
  try {
    response = await api.getNdviMonthly(lat, lon, fetchYear);
  } catch (err) {
    inFlightKeys.delete(key);
    // Disable auto-fetch for the rest of the session if creds are bad, so we
    // don't spam Sentinel Hub on every plot navigation. Manual Fetch still
    // works and will re-enable on success.
    const msg = String(err?.message || '').toLowerCase();
    if (auto && (msg.includes('credentials') || msg.includes('authentication') ||
                 msg.includes('unauthor') || msg.includes('no_creds') || msg.includes('invalid_creds'))) {
      autoFetchDisabled = true;
    }
    if (isCurrent()) {
      setStatus(err.message || 'NDVI fetch failed.', 'error');
      $('ndviFetchBtn').disabled = false;
      $('ndviRefreshBtn').disabled = false;
    }
    return;
  }

  const months = response.months || [];
  const next = {
    ...state.project,
    ndviCache: {
      ...(state.project.ndviCache || {}),
      [fetchPlotId]: {
        year: response.year ?? fetchYear,
        months,
        fetchedAt: new Date().toISOString(),
      },
    },
  };
  setState({ project: next });
  api.saveNdviCache(projectId, fetchPlotId, response.year ?? fetchYear, months)
     .catch((e) => console.warn('NDVI cache persist failed', e));

  // Successful fetch re-enables auto-fetch (covers the "user re-added creds
  // and clicked Fetch" case).
  autoFetchDisabled = false;
  inFlightKeys.delete(key);

  if (isCurrent()) {
    $('ndviFetchBtn').disabled   = false;
    $('ndviRefreshBtn').disabled = false;
    if (response.warning) setStatus(response.warning, 'warn');
    renderForCurrentPlot();
  }
}

export function fetchNdvi()   { doFetch({ forceRefresh: false }); }
export function refreshNdvi() { doFetch({ forceRefresh: true  }); }

// ── Chart ─────────────────────────────────────────────────────────────────
function destroyChart() {
  if (chart) { chart.destroy(); chart = null; }
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function renderChart(months, ndviRange) {
  const canvas = $('ndviChart');
  if (!canvas || typeof window.Chart === 'undefined') return;

  const ndviSeries = MONTH_LABELS.map((_, i) => {
    const m = months[i];
    return m && m.mean != null ? m.mean : null;
  });

  const minBand = Array.isArray(ndviRange) ? ndviRange[0] : null;
  const maxBand = Array.isArray(ndviRange) ? ndviRange[1] : null;
  const bandLo  = minBand != null ? new Array(12).fill(minBand) : null;
  const bandHi  = maxBand != null ? new Array(12).fill(maxBand) : null;

  // Annual mean of all valid months
  const valid = ndviSeries.filter(v => v != null);
  const annualMean = valid.length >= 2
    ? valid.reduce((a, b) => a + b, 0) / valid.length
    : null;

  const datasets = [];
  if (bandLo && bandHi) {
    datasets.push({
      label: 'Reference min',
      data: bandLo,
      borderColor: 'rgba(59,130,246,0)',
      backgroundColor: 'rgba(59,130,246,0)',
      pointRadius: 0,
      tension: 0,
      fill: false,
      order: 3,
    });
    datasets.push({
      label: 'Reference range',
      data: bandHi,
      borderColor: 'rgba(59,130,246,0)',
      backgroundColor: 'rgba(59,130,246,.18)',
      pointRadius: 0,
      tension: 0,
      fill: '-1',
      order: 2,
    });
  }
  if (annualMean != null) {
    datasets.push({
      label: `Annual mean (${annualMean.toFixed(3)})`,
      data: new Array(12).fill(annualMean),
      borderColor: 'rgba(255,255,255,.6)',
      backgroundColor: 'rgba(255,255,255,.6)',
      borderWidth: 1.5,
      borderDash: [6, 4],
      pointRadius: 0,
      tension: 0,
      fill: false,
      order: 0,
    });
  }
  datasets.push({
    label: 'NDVI (monthly mean)',
    data: ndviSeries,
    borderColor: '#22c55e',
    backgroundColor: '#22c55e',
    spanGaps: true,
    pointRadius: 4,
    pointHoverRadius: 6,
    pointStyle: 'circle',     // on-curve marker: filled circle
    tension: 0.25,
    fill: false,
    order: 1,
  });

  if (chart) {
    chart.data.labels = MONTH_LABELS;
    chart.data.datasets = datasets;
    chart.update();
    return;
  }
  chart = new window.Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: MONTH_LABELS, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: '#8b8d97',
            font: { size: 10 },
            usePointStyle: true,
            boxWidth: 24,
            boxHeight: 2,
            filter: (item) => item.text !== 'Reference min',
            // Render line datasets as line samples in the legend without
            // changing the on-curve marker style.
            generateLabels: (chartInstance) => {
              const ds = chartInstance.data.datasets || [];
              return ds.map((d, i) => {
                const isAnnualMean = String(d.label || '').startsWith('Annual mean');
                const isNdvi       = d.label === 'NDVI (monthly mean)';
                return {
                  text: d.label,
                  datasetIndex: i,
                  hidden: !chartInstance.isDatasetVisible(i),
                  fontColor: '#8b8d97',
                  // Force a horizontal line for the two line datasets; let
                  // Reference range keep its default filled rectangle.
                  pointStyle: (isAnnualMean || isNdvi) ? 'line' : 'rect',
                  strokeStyle: d.borderColor,
                  fillStyle:   isAnnualMean ? d.borderColor : d.backgroundColor,
                  lineWidth:   isAnnualMean ? 2 : (isNdvi ? 2 : 0),
                  lineDash:    isAnnualMean ? [4, 3] : [],
                };
              });
            },
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y == null ? 'no data' : ctx.parsed.y.toFixed(3)}`,
          },
        },
      },
      scales: {
        y: {
          min: -0.2, max: 1.0,
          ticks: { color: '#8b8d97', font: { size: 10 } },
          grid: { color: 'rgba(255,255,255,.05)' },
          title: { display: true, text: 'NDVI', color: '#8b8d97', font: { size: 11 } },
        },
        x: {
          ticks: { color: '#8b8d97', font: { size: 10 } },
          grid: { color: 'rgba(255,255,255,.05)' },
        },
      },
    },
  });
}

// ── Bootstrap (called once from app.js init) ──────────────────────────────
export function initNdviPanel() {
  if (initialized) return;
  initialized = true;

  // Inject the line-chart icon into both the toolbar button and the panel header.
  document.querySelectorAll('.ndvi-icon').forEach(el => {
    if (!el.querySelector('svg')) el.innerHTML = LINE_CHART_SVG;
  });

  populateYearSelect();
  initDrag();
  initResize();
  initSplit();
  initColResize();

  // Build the label→defaults lookup in the background so existing projects
  // whose classSchema predates the seeded defaults still get suggestions.
  loadDefaultsByLabel().then(() => {
    if (state.ndviPanelOpen) renderGuideTable();
  }).catch(() => {});
}
