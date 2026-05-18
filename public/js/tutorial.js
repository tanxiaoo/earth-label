// EarthLabel interactive guided tour.
//
// Architecture mirrors the PRISMA tool tutorial:
// - TUTORIAL_STEPS array defines each step (target CSS selector, title, body, card position)
// - A full-screen overlay darkens everything except a transparent "cutout" div
//   that sits over the target element — the massive box-shadow on the cutout
//   creates the spotlight effect without touching z-index on app elements
// - A floating card shows title, description, Back / Next / Skip controls
// - State persists: once finished, the tour doesn't auto-start again
//   (localStorage key 'earthlabel_tour_done'); relaunch via the ? button

const STORAGE_KEY = 'earthlabel_tour_done';
const CARD_WIDTH  = 310;  // px — used for smart positioning

// ── Step definitions ──────────────────────────────────────────────────────
// position: 'right' | 'left' | 'bottom' | 'top' | 'center'
// target: CSS selector string, or null for a centred welcome/finish card
const TUTORIAL_STEPS = [
  {
    id:       'welcome',
    target:   null,
    position: 'center',
    title:    'Welcome to EarthLabel',
    body:     'EarthLabel is a self-hosted satellite image interpretation platform for land-cover validation. This tour walks you through every feature in about 2 minutes. Press Next to begin, or Skip to dismiss.',
  },
  {
    id:       'create-project',
    target:   '[data-tutorial="create-project"]',
    position: 'right',
    title:    '1 · Create a Project',
    body:     'Click "+ New" to start. Upload a CSV, GeoJSON, KML, or Shapefile with your sample points. Give the project a name and pick a classification schema (10 built-in presets or start blank). The project is saved as a JSON file on disk — portable and version-controllable.',
  },
  {
    id:       'basemaps',
    target:   '[data-tutorial="basemaps"]',
    position: 'bottom',
    title:    '2 · Multi-source Imagery',
    body:     'Switch between Google Satellite, ESRI Wayback (year-end snapshots 2018–2025, no key needed), Bing, Sentinel-2 annual composites (2018–2024), and Planet monthly mosaics (2016–2026). Year and month selectors appear automatically for time-stamped sources.',
  },
  {
    id:       'split-view',
    target:   '[data-tutorial="split-view"]',
    position: 'bottom',
    title:    '3 · Split View',
    body:     'Toggle Split to compare two basemaps side-by-side with synced pan/zoom — for example, compare ESRI Wayback 2019 on the left with Planet June 2023 on the right to see land-cover change.',
  },
  {
    id:       'ndvi',
    target:   '[data-tutorial="ndvi-btn"]',
    position: 'bottom',
    title:    '4 · NDVI Time Series',
    body:     'Open the NDVI panel to see monthly Sentinel-2 NDVI curves for each plot (requires free Sentinel Hub / CDSE credentials — see Settings). The chart auto-fetches when you navigate between plots and caches results per project. Use the Season button inside the panel to overlay the growing season band (Apr–Sep).',
  },
  {
    id:       'gep',
    target:   '[data-tutorial="gep-btn"]',
    position: 'bottom',
    title:    '5 · Google Earth Pro Sync',
    body:     'Open google_earth_link.kml in Google Earth Pro. EarthLabel flies GEP to each plot automatically on navigation. In pixel mode, GEP shows the UA square outline and colour-coded sub-point dots (orange = selected, green/grey = classified/unclassified). Toggle "GEP" to mark that you used GEP as your reference and type the year from GEP\'s time slider — saved with the result.',
  },
  {
    id:       'ua-badge',
    target:   '[data-tutorial="ua-badge"]',
    position: 'right',
    title:    '6 · Assessment Mode',
    body:     'Each project is either Point mode (one classification per plot) or Pixel mode (CEO-compliant Unit of Assessment). In Pixel mode a correctly-sized UA square is drawn on the map and a sub-point grid (3×3 or 5×5) is placed inside. Click ⚙ UA to change the UA size, grid, and aggregation rule for the current project.',
  },
  {
    id:       'class-list',
    target:   '[data-tutorial="class-list"]',
    position: 'left',
    title:    '7 · Classify',
    body:     'Click a class button — or press its keyboard shortcut — to classify the current plot (Point mode) or sub-point (Pixel mode). In Pixel mode each sub-point is classified individually; the majority vote determines the final plot label. The dot row above shows progress.',
  },
  {
    id:       'confidence',
    target:   '[data-tutorial="confidence"]',
    position: 'left',
    title:    '8 · Confidence',
    body:     'Select High, Medium, or Low confidence for each classification. Exported as the "confidence" column — useful for flagging uncertain points for later review or second-pass annotation.',
  },
  {
    id:       'image-source',
    target:   '[data-tutorial="image-source"]',
    position: 'top',
    title:    '9 · Image Source Tracking',
    body:     'This indicator shows exactly which basemap and year will be recorded when you submit (e.g. "Planet · 2024-06" or "ESRI Wayback · 2021"). It updates live as you switch layers. The recorded source and date are exported as "image_source" and "image_date" columns in CSV/GeoJSON.',
  },
  {
    id:       'timer',
    target:   '[data-tutorial="timer"]',
    position: 'top',
    title:    '10 · Time Tracking',
    body:     'A per-plot timer starts automatically on each navigation. Press ⏸ to pause during interruptions — idle time is excluded. Classifying a point while paused auto-resumes the timer. The total seconds are saved as "time_spent_s" in the export — useful for estimating annotation cost at scale.',
  },
  {
    id:       'submit',
    target:   '[data-tutorial="submit"]',
    position: 'top',
    title:    '11 · Submit & Advance',
    body:     'Click Submit (or press Enter / Space) to save the classification and advance to the next unclassified plot. In Pixel mode the button shows how many sub-points remain and unlocks only when all are done. The result is auto-saved to disk immediately.',
  },
  {
    id:       'export',
    target:   '[data-tutorial="export"]',
    position: 'top',
    title:    '12 · Export Results',
    body:     'Download your results as CSV (flat table ready for Excel or Python) or GeoJSON (preserves original geometry). Pixel-mode exports include per-sub-point class columns (sp_0…sp_N), agreement stats, image source, image date, and time spent. Re-classifying a plot updates the next export immediately.',
  },
  {
    id:       'plot-list',
    target:   '[data-tutorial="plot-list"]',
    position: 'right',
    title:    '13 · Plot List & Filters',
    body:     'The sidebar lists all plots with their status badge. Filter by All / Pending / Done. Click any plot to jump to it. The progress bar and counter (e.g. "12 / 384") update in real time. Completed plots show your classification label; pending plots show the reference label (if provided).',
  },
  {
    id:       'settings',
    target:   '[data-tutorial="settings"]',
    position: 'right',
    title:    '14 · Settings & API Keys',
    body:     'Open Settings to add your Planet API key (for PlanetScope imagery) and Sentinel Hub credentials (for NDVI). Keys are stored in .env on your local machine and never sent to the browser. See docs/USER_GUIDE.md for step-by-step credential setup.',
  },
  {
    id:       'finish',
    target:   null,
    position: 'center',
    title:    'You\'re all set!',
    body:     'That covers the full EarthLabel workflow. For detailed documentation see docs/USER_GUIDE.md. Click the ? button in the toolbar any time to relaunch this tour. Happy classifying!',
  },
];

// ── State ─────────────────────────────────────────────────────────────────
let step    = 0;
let running = false;

// ── DOM helpers ───────────────────────────────────────────────────────────
const $  = id  => document.getElementById(id);
const qs = sel => document.querySelector(sel);

// ── Public API ────────────────────────────────────────────────────────────
export function initTutorial() {
  // Wire navigation directly — avoid relying on window.app from onclick attrs
  // inside the fixed overlay, which can silently fail in some browsers.
  document.addEventListener('DOMContentLoaded', _wireButtons);
  // Also try immediately in case DOM is already ready
  if (document.readyState !== 'loading') _wireButtons();
}

function _wireButtons() {
  const nextBtn = $('tourNext');
  const prevBtn = $('tourPrev');
  const skipBtn = document.querySelector('.tour-skip');
  if (nextBtn) nextBtn.addEventListener('click', tutorialNext);
  if (prevBtn) prevBtn.addEventListener('click', tutorialPrev);
  if (skipBtn) skipBtn.addEventListener('click',  skipTutorial);
}

export function startTutorial() {
  running = true;
  step    = 0;
  // Build progress dots once per session
  const dotsEl = $('tourDots');
  if (dotsEl && !dotsEl.children.length) {
    TUTORIAL_STEPS.forEach((_, i) => {
      const d = document.createElement('span');
      d.className = 'tour-dot';
      d.dataset.step = i;
      dotsEl.appendChild(d);
    });
  }
  showStep();
}

export function tutorialNext() {
  if (!running) return;
  if (step < TUTORIAL_STEPS.length - 1) { step++; showStep(); }
  else endTutorial();
}

export function tutorialPrev() {
  if (!running || step === 0) return;
  step--;
  showStep();
}

export function skipTutorial() {
  endTutorial();
}

// ── Core ──────────────────────────────────────────────────────────────────
function showStep() {
  const s = TUTORIAL_STEPS[step];

  // Update card text — apply inline styles to guarantee visibility
  // regardless of any CSS cascade issues inside the fixed overlay.
  const titleEl = $('tourTitle');
  const bodyEl  = $('tourBody');
  const progEl  = $('tourProgress');
  const prevBtn = $('tourPrev');
  const nextBtn = $('tourNext');

  if (titleEl) {
    titleEl.textContent = s.title;
    titleEl.style.cssText = 'color:#e4e4e7;font-size:14px;font-weight:700;margin:0 0 10px;display:block;';
  }
  if (bodyEl) {
    bodyEl.textContent = s.body;
    bodyEl.style.cssText = 'color:#a0a3b1;font-size:12px;line-height:1.65;margin:0 0 14px;display:block;';
  }
  if (progEl) progEl.textContent = `${step + 1} / ${TUTORIAL_STEPS.length}`;
  if (prevBtn) prevBtn.disabled  = step === 0;
  if (nextBtn) nextBtn.textContent = step === TUTORIAL_STEPS.length - 1 ? 'Finish' : 'Next →';

  // Update progress dots
  const dots = document.querySelectorAll('.tour-dot');
  dots.forEach((d, i) => d.classList.toggle('active', i === step));

  // Highlight target or center card
  if (s.target) {
    const el = qs(s.target);
    if (el) {
      positionOnElement(el, s.position);
    } else {
      centerCard();  // element not visible in current view — gracefully center
    }
  } else {
    clearCutout();
    centerCard();
  }

  $('tourOverlay').classList.remove('hidden');
}

function positionOnElement(el, position) {
  const PAD  = 10;
  const rect = el.getBoundingClientRect();

  // Element is hidden (display:none or off-screen) — center the card instead
  if (!rect.width && !rect.height) { centerCard(); return; }

  // Move cutout over the element
  const cutout = $('tourCutout');
  cutout.style.left   = `${rect.left   - PAD}px`;
  cutout.style.top    = `${rect.top    - PAD}px`;
  cutout.style.width  = `${rect.width  + PAD * 2}px`;
  cutout.style.height = `${rect.height + PAD * 2}px`;
  cutout.style.display = 'block';

  // Scroll into view
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Position card
  const card = $('tourCard');
  const cW   = CARD_WIDTH;
  const cH   = card.offsetHeight || 220;
  const vw   = window.innerWidth;
  const vh   = window.innerHeight;
  let left, top;

  switch (position) {
    case 'right':
      left = rect.right + PAD + 16;
      top  = rect.top + rect.height / 2 - cH / 2;
      break;
    case 'left':
      left = rect.left - PAD - cW - 16;
      top  = rect.top + rect.height / 2 - cH / 2;
      break;
    case 'bottom':
      left = rect.left + rect.width / 2 - cW / 2;
      top  = rect.bottom + PAD + 16;
      break;
    case 'top':
    default:
      left = rect.left + rect.width / 2 - cW / 2;
      top  = rect.top - PAD - cH - 16;
      break;
  }

  // Clamp to viewport
  left = Math.max(16, Math.min(left, vw - cW - 16));
  top  = Math.max(16, Math.min(top,  vh - cH - 16));

  card.style.left      = `${left}px`;
  card.style.top       = `${top}px`;
  card.style.transform = 'none';
}

function clearCutout() {
  const c = $('tourCutout');
  c.style.display = 'none';
}

function centerCard() {
  clearCutout();
  const card = $('tourCard');
  card.style.left      = '50%';
  card.style.top       = '50%';
  card.style.transform = 'translate(-50%, -50%)';
}

function endTutorial() {
  running = false;
  localStorage.setItem(STORAGE_KEY, '1');
  $('tourOverlay').classList.add('hidden');
  clearCutout();
}
