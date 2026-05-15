import { state, setState } from './state.js';
import * as api from './api.js';
import { initMap, navigateToPlot, setMapLayer, switchBasemap, toggleSplitView,
         updateEsriYear, updateSentinel2Year, updatePlanetParams } from './map.js';
import { renderClassButtons, openClassEditor, closeClassEditor, saveClassSchema,
         saveSchemaAsPreset, addEditorClass, applyEditorPreset, exportClassSchema,
         importClassSchema, renderSchemaPreview } from './classes.js';
import { renderAnnotationInputs, readAnnotationInputs, clearAnnotationInputs,
         openAnnotationFieldsEditor, closeAnnotationFieldsEditor,
         addAnnotationField, saveAnnotationFields } from './annotation-fields.js';
import { exportCSV, exportGeoJSON, exportProjectFile } from './export.js';
import { initNdviPanel, openNdviPanel, closeNdviPanel, toggleNdviPanel,
         renderForCurrentPlot as renderNdviForCurrentPlot,
         fetchNdvi, refreshNdvi, saveNdviGuide, resetNdviGuide,
         toggleNdviGuide, onNdviYearChange } from './ndvi-panel.js';

// ── tiny helpers ──────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');
const errMsg = (id, msg) => { const el=$(id); el.textContent=msg||''; el.classList.toggle('hidden',!msg); };

// ── Preset dropdown population ────────────────────────────────────────────
function populatePresetSelect(selectId, presets) {
  const sel = $(selectId);
  sel.innerHTML = '';
  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

function setKeyBadge(id, isSet) {
  const el = $(id);
  if (!el) return;
  el.textContent = isSet ? 'SET' : 'NOT SET';
  el.className = `key-status ${isSet ? 'set' : 'unset'}`;
}

// ── Boot ──────────────────────────────────────────────────────────────────
async function init() {
  initMap();
  setupDropZone();

  // Hydrate GE zoom slider from saved value
  const slider = $('geRangeSlider');
  if (slider) {
    slider.value = state.geRange;
    const lbl = $('geRangeLabel');
    if (lbl) lbl.textContent = `${state.geRange} m`;
  }

  try {
    const presets = await api.listPresets();
    setState({ presets });
    populatePresetSelect('presetSelect', presets);
  } catch (e) { console.warn('Could not load presets', e); }

  try {
    const status = await api.getKeyStatus();
    setKeyBadge('planetKeyStatus', status.planet);
    setKeyBadge('shIdStatus',      status.sentinel_hub_id);
    setKeyBadge('shSecretStatus',  status.sentinel_hub_sec);
  } catch (_) {}

  initNdviPanel();

  try {
    const projects = await api.listProjects();
    if (projects.length === 0) { show('welcomeOverlay'); return; }
    const lastId = localStorage.getItem('lastProjectId');
    const target = projects.find(p => p.id === lastId);
    if (target) await loadProject(target.id);
    else showProjectListView();
  } catch (e) {
    console.error('Init failed', e);
    show('welcomeOverlay');
  }
}

// ── Project list view ─────────────────────────────────────────────────────
export function showProjectListView() {
  $('sidebar-projects-view').style.display = 'flex';
  $('sidebar-plots-view').style.display    = 'none';
  refreshProjectList();
}

async function refreshProjectList() {
  let projects = [];
  try { projects = await api.listProjects(); } catch (_) {}
  if (state.projectSort === 'name') projects.sort((a,b) => a.name.localeCompare(b.name));

  const c = $('projectListContainer');
  c.innerHTML = '';
  if (!projects.length) {
    c.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:13px;">No projects yet.</div>';
    return;
  }
  projects.forEach(p => {
    const pct = p.plotCount ? Math.round(p.completedCount / p.plotCount * 100) : 0;
    const div = document.createElement('div');
    div.className = 'plot-item';
    div.onclick = () => loadProject(p.id);
    div.innerHTML = `
      <div class="plot-info">
        <div class="plot-id" style="font-size:14px;font-family:'DM Sans',sans-serif;">${p.name}</div>
        <div class="plot-label">${p.completedCount} / ${p.plotCount} plots · ${pct}%</div>
      </div>
      <div style="width:48px;height:4px;background:#2a2d3a;border-radius:2px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:var(--success);"></div>
      </div>`;
    c.appendChild(div);
  });
}

export function setProjectSort(type) {
  setState({ projectSort: type });
  $('sort-recent').classList.toggle('active', type === 'recent');
  $('sort-name').classList.toggle('active',   type === 'name');
  refreshProjectList();
}

// ── Load project ──────────────────────────────────────────────────────────
async function loadProject(id) {
  let proj;
  try { proj = await api.loadProject(id); }
  catch (e) { alert(`Could not load project: ${e.message}`); return; }

  // Backward compat: projects saved before annotationFields existed have no
  // such key. Default to a single text field named `notes` so the UI keeps
  // showing the legacy "Notes" textarea with the same data.
  if (!Array.isArray(proj.annotationFields) || proj.annotationFields.length === 0) {
    proj.annotationFields = [{ key: 'notes', label: 'Notes', type: 'text' }];
  }

  const plots = proj.plots.map(p => {
    const r = proj.results?.[p.id] || {};
    // Legacy result.notes (no annotations object) maps to annotations.notes.
    const annotations = r.annotations ?? (r.notes != null ? { notes: r.notes } : {});
    return { ...p,
      resultCode:  r.code  ?? null, resultLabel: r.label ?? null,
      confidence:  r.confidence ?? null,
      annotations,
      completed:   !!(r.code != null),
    };
  });

  setState({ project: proj, plots, currentIndex:-1,
             selectedClass:null, selectedConfidence:null, isFirstPlotLoad:true });

  localStorage.setItem('lastProjectId', id);
  $('activeProjectName').textContent = proj.name;
  $('sidebar-projects-view').style.display = 'none';
  $('sidebar-plots-view').style.display    = 'flex';

  renderClassButtons();
  renderPlotList();
  updateProgress();
  renderAnnotationInputs(null);
  document.querySelectorAll('.conf-btn').forEach(b => b.classList.remove('selected'));
  hide('welcomeOverlay');

  if (plots.length) {
    const first = plots.findIndex(p => !p.completed);
    goToPlot(first >= 0 ? first : 0);
  } else {
    $('molcaRef').innerHTML = 'Reference: <span>–</span>';
    $('plotCounter').textContent = '–';
    $('btn-ge').disabled = true;
  }
}

// ── Create project modal ──────────────────────────────────────────────────
let _previewClasses = [];

export function openCreateProjectModal() {
  hide('welcomeOverlay');
  $('newProjectName').value = '';
  $('newProjectFile').value = '';
  $('dropZoneLabel').textContent = 'Click to select or drag & drop';
  $('schemaPreview').innerHTML = '';
  errMsg('createError', '');
  _previewClasses = [];
  if (state.presets.length) {
    const def = state.presets.find(p => p.id === 'molca') || state.presets[0];
    $('presetSelect').value = def.id;
    onPresetChange();
  }
  show('createProjectModal');
}

export function closeCreateProjectModal() {
  hide('createProjectModal');
  if (!state.project && !state.plots.length) show('welcomeOverlay');
}

export async function onPresetChange() {
  const id = $('presetSelect').value;
  if (!id || id === 'custom') { _previewClasses = []; renderSchemaPreview([]); return; }
  try {
    const preset = await api.getPreset(id);
    _previewClasses = preset.classes;
    renderSchemaPreview(preset.classes);
  } catch (_) {}
}

export async function createNewProject() {
  const name = $('newProjectName').value.trim();
  if (!name) { errMsg('createError', 'Enter a project name'); return; }
  const file = $('newProjectFile').files[0];
  errMsg('createError', '');
  try {
    const { id } = await api.createProject(name, _previewClasses, file || null);
    hide('createProjectModal');
    await loadProject(id);
  } catch (e) { errMsg('createError', e.message); }
}

// ── Delete project ────────────────────────────────────────────────────────
export async function deleteCurrentProject() {
  if (!state.project) return;
  if (!confirm(`Delete "${state.project.name}"? This cannot be undone.`)) return;
  await api.deleteProject(state.project.id);
  localStorage.removeItem('lastProjectId');
  setState({ project:null, plots:[], currentIndex:-1 });
  const projects = await api.listProjects();
  showProjectListView();
  if (!projects.length) show('welcomeOverlay');
}

// ── Import/export project ─────────────────────────────────────────────────
export function importProjectFile() { $('importProjectInput').click(); }

export async function onImportProjectFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const { id } = await api.importProject(file);
    hide('welcomeOverlay');
    await loadProject(id);
  } catch (e) { alert(`Import failed: ${e.message}`); }
  event.target.value = '';
}

// ── Plot list ─────────────────────────────────────────────────────────────
function renderPlotList() {
  const schema = state.project?.classSchema || [];
  const list   = $('plotList');
  list.innerHTML = '';

  state.plots
    .map((p,i) => ({...p, idx:i}))
    .filter(p => {
      if (state.currentFilter === 'pending') return !p.completed;
      if (state.currentFilter === 'done')    return  p.completed;
      return true;
    })
    .forEach(p => {
      // Tag rule:
      //   - "Done" filter view → show the user's latest classification
      //     (so it acts as the "Done list" with each plot's chosen label).
      //   - "All" / "Pending" → show the reference class so users can
      //     compare against ground truth at a glance.
      const showUserLabel = state.currentFilter === 'done' && p.completed;
      const tagCls = showUserLabel
        ? schema.find(c => String(c.code) === String(p.resultCode))
        : schema.find(c => String(c.code) === String(p.refCode));
      const fallbackLabel = showUserLabel ? p.resultLabel : p.refLabel;
      const div = document.createElement('div');
      div.className = `plot-item ${p.idx===state.currentIndex?'active':''} ${p.completed?'completed':''}`;
      div.onclick = () => goToPlot(p.idx);
      div.innerHTML = `
        <div class="plot-status ${p.completed?'done':'pending'}"></div>
        <div class="plot-info">
          <div class="plot-id">Plot #${p.id}</div>
          <div class="plot-label">${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}</div>
        </div>
        ${tagCls
          ? `<span class="plot-molca-badge" style="background:${tagCls.color}">${tagCls.label}</span>`
          : (fallbackLabel ? `<span class="plot-molca-badge" style="background:#555;color:#fff">${fallbackLabel}</span>` : '')}`;
      list.appendChild(div);
    });
}

function updateProgress() {
  const done  = state.plots.filter(p => p.completed).length;
  const total = state.plots.length;
  const pct   = total ? done/total*100 : 0;
  $('progressFill').style.width = pct + '%';
  $('progressText').textContent = `${done} / ${total}`;
}

export function filterPlots(type) {
  setState({ currentFilter: type });
  ['all','pending','done'].forEach(t => $(`filter-${t}`)?.classList.toggle('active', t===type));
  renderPlotList();
}

// ── Navigation ────────────────────────────────────────────────────────────
export function goToPlot(index) {
  const { plots } = state;
  if (index < 0 || index >= plots.length) return;
  setState({ currentIndex: index });
  const p = plots[index];

  navigateToPlot(p);
  setState({ isFirstPlotLoad: false });

  api.updateKML(p.lat, p.lon, p.id, p.refLabel || '', state.geRange);

  const schema    = state.project?.classSchema || [];
  const refCls    = schema.find(c => String(c.code) === String(p.refCode));
  const refColor  = refCls?.color || '#888';
  const refText   = refCls ? `${refCls.label} (${p.refCode})`
                            : (p.refLabel || '–');
  const userCls   = schema.find(c => String(c.code) === String(p.resultCode));
  const userColor = userCls?.color || '#888';
  const userText  = userCls ? `${userCls.label} (${p.resultCode})`
                             : (p.resultLabel || null);
  $('molcaRef').innerHTML =
    `Reference: <span style="color:${refColor}">${refText}</span>` +
    (userText ? `<br><span style="opacity:.85;">Your label: <span style="color:${userColor}">${userText}</span></span>` : '');

  setState({ selectedClass: p.resultCode??null, selectedConfidence: p.confidence??null });
  renderAnnotationInputs(p);
  renderClassButtons();
  updateConfidenceUI();
  updateSubmitBtn();
  $('btn-ge').disabled = false;
  $('plotCounter').textContent = `${index+1} / ${plots.length}`;
  renderPlotList();

  if (state.ndviPanelOpen) renderNdviForCurrentPlot();
}

export function nextPlot() {
  const { plots, currentIndex } = state;
  for (let i = currentIndex+1; i < plots.length; i++) if (!plots[i].completed) { goToPlot(i); return; }
  for (let i = 0; i < currentIndex; i++)               if (!plots[i].completed) { goToPlot(i); return; }
  if (currentIndex+1 < plots.length) goToPlot(currentIndex+1);
}

export function prevPlot() {
  if (state.currentIndex > 0) goToPlot(state.currentIndex - 1);
}

// One-shot: opens Google Earth Web for the current plot in a new tab.
// Subsequent plot navigations do not auto-open — the user clicks the button
// each time they want to view a plot in Google Earth.
// The URL distance segment (`<range>d`) uses the current toolbar zoom.
// GE Web's URL parser snaps to its own zoom levels, so it's approximate;
// GE Pro receives the exact same value live via the KML NetworkLink.
export function openGoogleEarth() {
  const p = state.plots[state.currentIndex];
  if (!p) return;
  const d = Math.max(50, Number(state.geRange) || 1000);
  window.open(
    `https://earth.google.com/web/@${p.lat},${p.lon},0a,${d}d,35y,0h,0t,0r`,
    '_blank',
    'noopener'
  );
}

// Toolbar slider — drag to set GE Pro / GE Web view distance in meters.
// Push to the server live so GE Pro updates within ~1s.
export function onGeRangeInput(value) {
  const v = Math.max(50, Math.min(5000, Number(value) || 1000));
  setState({ geRange: v });
  localStorage.setItem('geRange', String(v));
  const label = $('geRangeLabel');
  if (label) label.textContent = `${v} m`;
  api.updateKMLRange(v);
}

// ── Classification ────────────────────────────────────────────────────────
export function selectClass(code) {
  setState({ selectedClass: code });
  renderClassButtons();
  updateSubmitBtn();
}

export function setConfidence(level) {
  setState({ selectedConfidence: level });
  updateConfidenceUI();
  updateSubmitBtn();
}

function updateConfidenceUI() {
  document.querySelectorAll('.conf-btn').forEach(b =>
    b.classList.toggle('selected', b.textContent === state.selectedConfidence));
}

function updateSubmitBtn() {
  $('submitBtn').disabled = !state.selectedClass;
}

export async function submitClassification() {
  if (!state.selectedClass || !state.project) return;
  const schema  = state.project.classSchema || [];
  const cls     = schema.find(c => c.code === state.selectedClass);
  const plotIdx = state.currentIndex;
  const plotId  = state.plots[plotIdx].id;
  const annotations = readAnnotationInputs();
  const result  = {
    code:       state.selectedClass,
    label:      cls?.label || '',
    confidence: state.selectedConfidence,
    annotations,
  };

  // Optimistic update — keep both `plots[i]` (UI source) and
  // `project.results[id]` (export/saved_at source) in sync so CSV/GeoJSON
  // exports reflect the latest classification immediately and re-classifying
  // a previous plot is captured.
  const plots = [...state.plots];
  plots[plotIdx] = { ...plots[plotIdx], resultCode:result.code, resultLabel:result.label,
                     confidence:result.confidence, annotations, completed:true };
  const results = { ...(state.project.results || {}),
                    [plotId]: { ...result, savedAt: new Date().toISOString() } };
  setState({
    plots,
    project: { ...state.project, results },
    selectedClass: null,
    selectedConfidence: null,
  });

  clearAnnotationInputs();
  updateProgress();
  renderPlotList();

  // Persist
  api.saveResult(state.project.id, plotId, result).catch(console.error);

  nextPlot();
}

// ── Settings ──────────────────────────────────────────────────────────────
function refreshKeyBadges() {
  return api.getKeyStatus().then(s => {
    setKeyBadge('planetKeyStatus', s.planet);
    setKeyBadge('shIdStatus',      s.sentinel_hub_id);
    setKeyBadge('shSecretStatus',  s.sentinel_hub_sec);
  });
}

export function openSettings() {
  $('planetApiKey').value     = '';
  $('shClientId').value       = '';
  $('shClientSecret').value   = '';
  errMsg('settingsMsg', '');
  refreshKeyBadges().catch(()=>{});
  show('settingsModal');
}
export function closeSettings() { hide('settingsModal'); }

export async function saveSettings() {
  const planet              = $('planetApiKey').value.trim();
  const sentinel_hub_id     = $('shClientId').value.trim();
  const sentinel_hub_secret = $('shClientSecret').value.trim();
  const payload = {};
  if (planet)              payload.planet              = planet;
  if (sentinel_hub_id)     payload.sentinel_hub_id     = sentinel_hub_id;
  if (sentinel_hub_secret) payload.sentinel_hub_secret = sentinel_hub_secret;
  if (Object.keys(payload).length === 0) {
    errMsg('settingsMsg','Enter at least one credential to save.');
    return;
  }
  try {
    await api.saveKeys(payload);
    await refreshKeyBadges();
    errMsg('settingsMsg','');
    closeSettings();
  } catch (e) { errMsg('settingsMsg', e.message); }
}

export async function clearKey(which) {
  await api.deleteKeys({ [which]:true });
  await refreshKeyBadges();
}

// ── Demo data ─────────────────────────────────────────────────────────────
export async function loadDemoData() {
  hide('welcomeOverlay');
  const demoCSV = `PLOTID,LAT,LON,ref_code,ref_label
1,0.5856,27.740,20,Forest
4,7.5617,13.775,5,Shrubland
5,7.2322,17.579,5,Shrubland
549,14.360,40.269,12,Bareland
694,2.3573,22.826,9,Wetland
695,14.028,9.587,15,Water
1100,1.5213,9.654,20,Forest
1120,1.8093,9.766,7,Grassland
1121,1.7711,9.761,12,Bareland
1140,1.0053,9.583,13,Built-up`;

  let molcaClasses = [];
  try { molcaClasses = (await api.getPreset('molca')).classes; } catch (_) {}

  const blob = new Blob([demoCSV], { type:'text/csv' });
  const file = new File([blob], 'demo.csv', { type:'text/csv' });

  try {
    const { id } = await api.createProject('Demo Project', molcaClasses, file);
    await loadProject(id);
  } catch (e) { alert(`Demo data error: ${e.message}`); }
}

// ── Drag & drop setup ─────────────────────────────────────────────────────
function setupDropZone() {
  const zone = $('dropZone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f) applyFile(f);
  });
  $('newProjectFile')?.addEventListener('change', e => { if (e.target.files[0]) applyFile(e.target.files[0]); });
}

function applyFile(file) {
  $('dropZoneLabel').textContent = `📄 ${file.name}`;
  try { const dt = new DataTransfer(); dt.items.add(file); $('newProjectFile').files = dt.files; } catch (_) {}
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  const schema = state.project?.classSchema || [];
  const cls = schema.find(c => c.key === e.key);
  if (cls) { selectClass(cls.code); return; }
  if (e.key === 'ArrowRight' || e.key === 'n') nextPlot();
  if (e.key === 'ArrowLeft'  || e.key === 'p') prevPlot();
  if ((e.key === 'Enter' || e.key === ' ') && !$('submitBtn').disabled) {
    e.preventDefault();   // suppress page scroll on Space
    submitClassification();
  }
  if (e.key === 'h') setConfidence('High');
  if (e.key === 'm') setConfidence('Medium');
  if (e.key === 'l') setConfidence('Low');
});

// ── Expose on window.app (for HTML onclick handlers) ─────────────────────
window.app = {
  openCreateProjectModal, closeCreateProjectModal, createNewProject, onPresetChange,
  setProjectSort, showProjectListView, deleteCurrentProject,
  importProjectFile, onImportProjectFile, exportProjectFile, loadDemoData,
  goToPlot, nextPlot, prevPlot, filterPlots,
  toggleSplitView, switchBasemap, setMapLayer,
  updateEsriYear, updateSentinel2Year, updatePlanetParams,
  selectClass, setConfidence, submitClassification,
  openSettings, closeSettings, saveSettings, clearKey,
  openClassEditor, closeClassEditor, saveClassSchema, saveSchemaAsPreset,
  addEditorClass, applyEditorPreset, exportClassSchema, importClassSchema,
  openAnnotationFieldsEditor, closeAnnotationFieldsEditor,
  addAnnotationField, saveAnnotationFields,
  exportCSV, exportGeoJSON,
  openGoogleEarth, onGeRangeInput,
  toggleNdviPanel, openNdviPanel, closeNdviPanel,
  fetchNdvi, refreshNdvi, saveNdviGuide, resetNdviGuide,
  toggleNdviGuide, onNdviYearChange,
};

// ── Start ─────────────────────────────────────────────────────────────────
init();
