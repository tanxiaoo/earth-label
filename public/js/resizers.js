// Drag handles between the left sidebar, the map and the right classify
// panel. Dragging a handle resizes its side panel; the map takes the rest.
// Widths are remembered per browser; double-click a handle to reset.

const PANELS = {
  sidebar:  { selector: '.sidebar',        defaultW: 340, min: 220, max: 640, edge: 'right' },
  classify: { selector: '.classify-panel', defaultW: 280, min: 220, max: 640, edge: 'left'  },
};
const MIN_MAP_W = 320;           // never squeeze the map below this
const STORE_KEY = 'panelWidths';

function _load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}

function _save(widths) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(widths)); } catch { /* storage blocked */ }
}

function _setWidth(el, w) {
  el.style.width = el.style.minWidth = `${w}px`;
}

// Leaflet re-measures its container on a window resize event.
let _raf = 0;
function _refreshMaps() {
  cancelAnimationFrame(_raf);
  _raf = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

// Largest width the panel may take while leaving the map MIN_MAP_W.
// (A hidden panel measures 0, so the other panel may then use its room.)
function _maxFor(name) {
  const others = Object.entries(PANELS)
    .filter(([n]) => n !== name)
    .reduce((sum, [, cfg]) => sum + (document.querySelector(cfg.selector)?.offsetWidth || 0), 0);
  return Math.min(PANELS[name].max, window.innerWidth - others - MIN_MAP_W);
}

function _clamp(name, w) {
  return Math.round(Math.max(PANELS[name].min, Math.min(_maxFor(name), w)));
}

// Show / hide the left panel (remembered per browser).
const COLLAPSE_KEY = 'sidebarCollapsed';

function _setCollapsed(on) {
  document.body.classList.toggle('sidebar-collapsed', on);
  try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
  _refreshMaps();
}

export function toggleSidebar() {
  _setCollapsed(!document.body.classList.contains('sidebar-collapsed'));
}

export function initPanelResizers() {
  let collapsed = false;
  try { collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { /* storage blocked */ }
  document.body.classList.toggle('sidebar-collapsed', collapsed);

  const widths = _load();
  for (const [name, cfg] of Object.entries(PANELS)) {
    const el = document.querySelector(cfg.selector);
    if (el && widths[name]) _setWidth(el, _clamp(name, widths[name]));
  }

  document.querySelectorAll('.panel-resizer').forEach(handle => {
    const name = handle.dataset.panel;
    const cfg  = PANELS[name];
    const el   = cfg && document.querySelector(cfg.selector);
    if (!el) return;

    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX, startW = el.offsetWidth;
      handle.classList.add('dragging');
      document.body.classList.add('panel-resizing');

      const onMove = ev => {
        const dx = ev.clientX - startX;
        // Left sidebar grows to the right; the right panel grows to the left.
        _setWidth(el, _clamp(name, startW + (cfg.edge === 'right' ? dx : -dx)));
        _refreshMaps();
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        handle.classList.remove('dragging');
        document.body.classList.remove('panel-resizing');
        _save({ ..._load(), [name]: el.offsetWidth });
        _refreshMaps();
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });

    handle.addEventListener('dblclick', () => {
      _setWidth(el, cfg.defaultW);
      const w = _load(); delete w[name]; _save(w);
      _refreshMaps();
    });
  });
}
