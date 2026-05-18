import { state, setState } from './state.js';
import * as api from './api.js';
import { initMap, navigateToPlot, setMapLayer, switchBasemap, toggleSplitView,
         updateEsriYear, updateSentinel2Year, updatePlanetParams,
         highlightSubPoint, refreshSubPoint,
         registerSubPointClickHandler } from './map.js';
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
  registerSubPointClickHandler(selectSubPoint);
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
    populatePresetSelect('editorPresetSelect', presets);
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

  // Load UA settings from project (with safe fallbacks for old projects)
  setState({
    project: proj, plots, currentIndex:-1,
    selectedClass:null, selectedConfidence:null, isFirstPlotLoad:true,
    selectedSubPointIdx: null, subPointResults: {},
    // UA settings from project file
    assessmentMode:       proj.assessmentMode       || 'point',
    plotSizeM:            proj.plotSizeM            || 30,
    subPointGrid:         proj.subPointGrid         || '5x5',
    aggregationRule:      proj.aggregationRule      || 'majority',
    aggregationThreshold: proj.aggregationThreshold || 0.5,
  });

  // Restore sub-point results from saved data
  const spResults = {};
  Object.entries(proj.results || {}).forEach(([plotId, r]) => {
    if (r.subPoints && Array.isArray(r.subPoints)) {
      spResults[plotId] = {};
      r.subPoints.forEach(sp => { spResults[plotId][sp.idx] = { code: sp.code, label: sp.label }; });
    }
  });
  setState({ subPointResults: spResults });

  localStorage.setItem('lastProjectId', id);
  $('activeProjectName').textContent = proj.name;
  $('sidebar-projects-view').style.display = 'none';
  $('sidebar-plots-view').style.display    = 'flex';

  _updateUABadge();
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

// Update the UA mode badge in the sidebar
function _updateUABadge() {
  const el = $('uaModeBadge');
  if (!el) return;
  if (state.assessmentMode === 'pixel') {
    el.textContent = `Pixel ${state.plotSizeM}m · ${state.subPointGrid}`;
    el.style.display = 'inline-block';
  } else {
    el.textContent = 'Point';
    el.style.display = 'inline-block';
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
  // Reset modal UA controls
  const ptRadio = document.getElementById('createAssessModePoint');
  if (ptRadio) ptRadio.checked = true;
  _toggleCreateUAFields('point');
  $('createPlotSizeM').value   = '30';
  $('createSubGrid').value     = '5x5';
  $('createAggRule').value     = 'majority';
  $('createAggThreshold').value = '50';
  show('createProjectModal');
}

export function closeCreateProjectModal() {
  hide('createProjectModal');
  if (!state.project && !state.plots.length) show('welcomeOverlay');
}

export function onCreateAssessModeChange() {
  const mode = document.querySelector('input[name="createAssessMode"]:checked')?.value || 'point';
  _toggleCreateUAFields(mode);
}

function _toggleCreateUAFields(mode) {
  const el = $('createUAFields');
  if (el) el.style.display = mode === 'pixel' ? 'block' : 'none';
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

  const mode     = document.querySelector('input[name="createAssessMode"]:checked')?.value || 'point';
  const sizeM    = parseInt($('createPlotSizeM').value) || 30;
  const grid     = $('createSubGrid').value || '5x5';
  const aggRule  = $('createAggRule').value || 'majority';
  const aggPct   = parseFloat($('createAggThreshold').value) / 100 || 0.5;

  const uaSettings = {
    assessmentMode:       mode,
    plotSizeM:            sizeM,
    subPointGrid:         grid,
    aggregationRule:      aggRule,
    aggregationThreshold: aggPct,
  };

  try {
    const { id } = await api.createProject(name, _previewClasses, file || null, uaSettings);
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

// ── Project settings modal ────────────────────────────────────────────────
export function openProjectSettings() {
  if (!state.project) return;
  $('settingsAssessMode').value    = state.assessmentMode;
  _toggleSettingsUAFields(state.assessmentMode);
  $('settingsPlotSizeM').value     = state.plotSizeM;
  $('settingsSubGrid').value       = state.subPointGrid;
  $('settingsAggRule').value       = state.aggregationRule;
  $('settingsAggThreshold').value  = Math.round(state.aggregationThreshold * 100);
  errMsg('projectSettingsMsg', '');
  show('projectSettingsModal');
}

export function closeProjectSettings() { hide('projectSettingsModal'); }

export function onSettingsAssessModeChange() {
  _toggleSettingsUAFields($('settingsAssessMode').value);
}

function _toggleSettingsUAFields(mode) {
  const el = $('settingsUAFields');
  if (el) el.style.display = mode === 'pixel' ? 'block' : 'none';
}

export async function saveProjectSettings() {
  if (!state.project) return;
  const mode    = $('settingsAssessMode').value;
  const sizeM   = parseInt($('settingsPlotSizeM').value) || 30;
  const grid    = $('settingsSubGrid').value || '5x5';
  const aggRule = $('settingsAggRule').value || 'majority';
  const aggPct  = parseFloat($('settingsAggThreshold').value) / 100 || 0.5;

  const uaSettings = {
    assessmentMode: mode, plotSizeM: sizeM,
    subPointGrid: grid, aggregationRule: aggRule, aggregationThreshold: aggPct,
  };

  try {
    await api.saveProjectSettings(state.project.id, uaSettings);
    setState({
      assessmentMode: mode, plotSizeM: sizeM,
      subPointGrid: grid, aggregationRule: aggRule, aggregationThreshold: aggPct,
    });
    // Patch local project object too
    Object.assign(state.project, uaSettings);
    _updateUABadge();
    closeProjectSettings();
    // Re-render current plot with new settings
    if (state.currentIndex >= 0) {
      setState({ selectedSubPointIdx: null });
      navigateToPlot(state.plots[state.currentIndex]);
      _updateClassifyPanelHeader();
    }
  } catch (e) { errMsg('projectSettingsMsg', e.message); }
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
  setState({ currentIndex: index, selectedSubPointIdx: null });
  const p = plots[index];

  navigateToPlot(p);
  setState({ isFirstPlotLoad: false });

  _syncKml(p);
  _updateImageSourceDisplay();

  const schema    = state.project?.classSchema || [];
  // Fall back to meta CDL columns when the CSV used non-standard names
  const refCode   = p.refCode   ?? p.meta?.cdl_label_code ?? null;
  const refLabel  = p.refLabel  ?? p.meta?.cdl_label_name ?? (refCode ? String(refCode) : null);
  const refCls    = schema.find(c => String(c.code) === String(refCode));
  const refColor  = refCls?.color || '#aaa';
  const refText   = refCls ? `${refCls.label} (${refCode})` : (refLabel || '–');
  const userCls   = schema.find(c => String(c.code) === String(p.resultCode));
  const userColor = userCls?.color || '#888';
  const userText  = userCls ? `${userCls.label} (${p.resultCode})` : (p.resultLabel || null);
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
  _updateClassifyPanelHeader();

  if (state.ndviPanelOpen) renderNdviForCurrentPlot();

  // In pixel mode: auto-select the first unclassified sub-point
  if (state.assessmentMode === 'pixel') {
    const totalPts = _subPointTotal();
    const spRes    = state.subPointResults[p.id] || {};
    const firstUnclassified = _firstUnclassifiedSubPoint(p.id);
    if (firstUnclassified != null) {
      setState({ selectedSubPointIdx: firstUnclassified });
      highlightSubPoint(null, firstUnclassified);
    } else if (Object.keys(spRes).length === totalPts) {
      _showSubPointSummary(p.id);
    }
    _updateSubPointProgress(p.id);
  }
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

export function openGoogleEarth() {
  const p = state.plots[state.currentIndex];
  if (!p) return;
  const d = Math.max(50, Number(state.geRange) || 1000);
  window.open(
    `https://earth.google.com/web/@${p.lat},${p.lon},0a,${d}d,35y,0h,0t,0r`,
    '_blank', 'noopener'
  );
}

// ── GEP source tracking ───────────────────────────────────────────────────
export function toggleGepMode() {
  const gepActive = !state.gepActive;
  setState({ gepActive, gepYear: gepActive ? state.gepYear : '' });
  const btn   = $('btn-gep');
  const input = $('gepYearInput');
  if (btn)   btn.classList.toggle('gep-active', gepActive);
  if (input) input.style.display = gepActive ? 'inline-block' : 'none';
  if (!gepActive && input) input.value = '';
  _updateImageSourceDisplay();
}

export function onGepYearInput(value) {
  setState({ gepYear: value.trim() });
  _updateImageSourceDisplay();
}

export function _updateImageSourceDisplay() {
  const el = document.getElementById('imageSrcIndicator');
  if (!el) return;
  const { source, date } = _readActiveImageSource();
  el.textContent = (date && date !== 'current') ? `${source} · ${date}` : source;
}

// Returns { source, date } for the currently active left basemap.
function _readActiveImageSource() {
  if (state.gepActive) {
    return { source: 'Google Earth Pro', date: state.gepYear || '' };
  }
  switch (state.leftBasemap) {
    case 'esri': {
      const year = document.getElementById('esri-year')?.value || '';
      return { source: 'ESRI Wayback', date: year };
    }
    case 'sentinel2': {
      const year = document.getElementById('s2-year')?.value || '';
      return { source: 'Sentinel-2', date: year };
    }
    case 'planet': {
      const year  = document.getElementById('planet-year')?.value  || '';
      const month = document.getElementById('planet-month')?.value || '';
      return { source: 'Planet', date: month ? `${year}-${month}` : year };
    }
    case 'bing':
      return { source: 'Bing', date: 'current' };
    default:
      return { source: 'Google', date: 'current' };
  }
}

// Builds the pixelMode payload for /kml/update from current state.
function _buildPixelModeForKml(plotId) {
  if (state.assessmentMode !== 'pixel') return null;
  const spRes  = state.subPointResults[plotId] || {};
  const schema = state.project?.classSchema || [];
  return {
    plotSizeM:       state.plotSizeM,
    subPointGrid:    state.subPointGrid,
    selectedIdx:     state.selectedSubPointIdx,
    subPointResults: Object.entries(spRes).map(([idx, v]) => {
      const cls = schema.find(c => String(c.code) === String(v.code));
      return { idx: Number(idx), code: v.code, label: v.label, color: cls?.color || '#888888' };
    }),
  };
}

function _syncKml(p) {
  if (!p) return;
  api.updateKML(p.lat, p.lon, p.id, p.refLabel || '', state.geRange, _buildPixelModeForKml(p.id));
}

export function onGeRangeInput(value) {
  const v = Math.max(50, Math.min(5000, Number(value) || 1000));
  setState({ geRange: v });
  localStorage.setItem('geRange', String(v));
  const label = $('geRangeLabel');
  if (label) label.textContent = `${v} m`;
  api.updateKMLRange(v);
}

// ── Sub-point helpers ─────────────────────────────────────────────────────
function _subPointTotal() {
  const n = parseInt(state.subPointGrid) || 5;
  return n * n;
}

function _firstUnclassifiedSubPoint(plotId) {
  const total = _subPointTotal();
  const spRes = state.subPointResults[plotId] || {};
  for (let i = 0; i < total; i++) {
    if (!spRes[i]) return i;
  }
  return null;
}

function _updateClassifyPanelHeader() {
  const header = $('classifyHeader');
  const subPtInfo = $('subPointInfo');
  if (!header || !subPtInfo) return;

  if (state.assessmentMode === 'pixel') {
    const p    = state.plots[state.currentIndex];
    const done = p ? Object.keys(state.subPointResults[p.id] || {}).length : 0;
    // For completed plots use the stored sub-point count as the authoritative total
    // so a grid-setting change after submission doesn't show "25/9".
    const storedTotal = state.project?.results?.[p?.id]?.subPoints?.length;
    const total = storedTotal ?? _subPointTotal();
    subPtInfo.style.display = 'block';
    subPtInfo.innerHTML = `
      <div class="sp-progress-label">Sub-points: <strong>${done}/${total}</strong></div>
      <div class="sp-dots">${_renderSubPointDots(p?.id, total)}</div>`;
    header.textContent = done < total
      ? `Sub-point ${(state.selectedSubPointIdx ?? 0) + 1} of ${total}`
      : 'Plot Summary';
  } else {
    header.textContent = 'Classify This Plot';
    subPtInfo.style.display = 'none';
  }
}

function _renderSubPointDots(plotId, total) {
  const spRes = state.subPointResults[plotId] || {};
  const schema = state.project?.classSchema || [];
  return Array.from({ length: total }, (_, i) => {
    const sp  = spRes[i];
    const cls = sp ? schema.find(c => String(c.code) === String(sp.code)) : null;
    const color = cls ? cls.color : (sp ? '#888' : '#2a2d3a');
    const border = i === state.selectedSubPointIdx ? '2px solid #f59e0b' : '1px solid #555';
    return `<span class="sp-dot" style="background:${color};border:${border}" title="Sub-point ${i+1}"></span>`;
  }).join('');
}

function _updateSubPointProgress(plotId) {
  _updateClassifyPanelHeader();
}

function _showSubPointSummary(plotId) {
  const result = computePlotLabel(plotId);
  const schema = state.project?.classSchema || [];
  const cls    = schema.find(c => String(c.code) === String(result.code));
  const ref    = $('molcaRef');
  if (ref) {
    const existing = ref.innerHTML;
    const summaryHtml = `<br><span style="opacity:.85;">Aggregated: <span style="color:${cls?.color||'#22c55e'}">${result.label}</span> (${result.pct}%)</span>`;
    if (!existing.includes('Aggregated:')) ref.innerHTML += summaryHtml;
  }
  updateSubmitBtn();
}

// Compute the plot-level LULC class from its sub-point results
export function computePlotLabel(plotId) {
  const spRes  = state.subPointResults[plotId] || {};
  const counts = {};
  Object.values(spRes).forEach(({ code, label }) => {
    const k = String(code);
    counts[k] = counts[k] || { code, label, n: 0 };
    counts[k].n++;
  });

  const total = Object.values(spRes).length;
  if (!total) return null;

  if (state.aggregationRule === 'threshold') {
    // Winner must clear the threshold
    const winner = Object.values(counts).find(c => c.n / total >= state.aggregationThreshold);
    if (winner) return { code: winner.code, label: winner.label, pct: Math.round(winner.n / total * 100) };
    // Fall back to majority if no class crosses threshold
  }

  // Majority: class with most votes wins
  const winner = Object.values(counts).sort((a, b) => b.n - a.n)[0];
  return { code: winner.code, label: winner.label, pct: Math.round(winner.n / total * 100) };
}

// ── Classification — Point Mode ───────────────────────────────────────────
export function selectClass(code) {
  if (state.assessmentMode === 'pixel') {
    // In pixel mode, selecting a class immediately classifies the current sub-point
    _classifySubPoint(code);
    return;
  }
  setState({ selectedClass: code });
  renderClassButtons();
  updateSubmitBtn();
}

// ── Classification — Pixel Mode (sub-points) ──────────────────────────────
// Called when user clicks a sub-point circle on the map
export function selectSubPoint(idx) {
  const prev = state.selectedSubPointIdx;
  setState({ selectedSubPointIdx: idx });
  highlightSubPoint(prev, idx);
  _updateClassifyPanelHeader();
  setState({ selectedClass: null });
  renderClassButtons();
  _syncKml(state.plots[state.currentIndex]);
}

function _classifySubPoint(classCode) {
  const p   = state.plots[state.currentIndex];
  if (!p) return;
  const idx = state.selectedSubPointIdx;
  if (idx == null) return;

  const schema = state.project?.classSchema || [];
  const cls    = schema.find(c => String(c.code) === String(classCode));

  const spResults = { ...state.subPointResults };
  spResults[p.id] = { ...(spResults[p.id] || {}), [idx]: { code: classCode, label: cls?.label || '' } };

  // Clear selectedSubPointIdx BEFORE refreshSubPoint so the just-classified
  // circle gets its class colour, not the "selected" orange highlight.
  setState({ subPointResults: spResults, selectedClass: null, selectedSubPointIdx: null });

  refreshSubPoint(p.id, idx);
  renderClassButtons();
  _updateSubPointProgress(p.id);

  // Advance to next unclassified sub-point
  const next = _firstUnclassifiedSubPoint(p.id);
  if (next != null) {
    setState({ selectedSubPointIdx: next });
    highlightSubPoint(null, next);
  } else {
    // All sub-points done — unlock submit
    _showSubPointSummary(p.id);
    updateSubmitBtn();
  }
  _updateClassifyPanelHeader();
  _syncKml(p);
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
  const btn = $('submitBtn');
  if (state.assessmentMode === 'pixel') {
    const p           = state.plots[state.currentIndex];
    const done        = p ? Object.keys(state.subPointResults[p.id] || {}).length : 0;
    const storedTotal = state.project?.results?.[p?.id]?.subPoints?.length;
    const total       = storedTotal ?? _subPointTotal();
    btn.disabled = done < total;
    btn.textContent = done < total
      ? `${total - done} sub-points remaining`
      : 'Submit Plot & Next →';
  } else {
    btn.disabled    = !state.selectedClass;
    btn.textContent = 'Submit & Next →';
  }
}

export async function submitClassification() {
  if (!state.project) return;

  if (state.assessmentMode === 'pixel') {
    await _submitPixelPlot();
  } else {
    await _submitPointPlot();
  }
}

async function _submitPointPlot() {
  if (!state.selectedClass) return;
  const schema  = state.project.classSchema || [];
  const cls     = schema.find(c => c.code === state.selectedClass);
  const plotIdx = state.currentIndex;
  const plotId  = state.plots[plotIdx].id;
  const annotations = readAnnotationInputs();
  const { source: imageSource, date: imageDate } = _readActiveImageSource();
  const result  = {
    code:        state.selectedClass,
    label:       cls?.label || '',
    confidence:  state.selectedConfidence,
    annotations,
    imageSource,
    imageDate,
  };

  const plots = [...state.plots];
  plots[plotIdx] = { ...plots[plotIdx], resultCode:result.code, resultLabel:result.label,
                     confidence:result.confidence, annotations, completed:true };
  const results = { ...(state.project.results || {}),
                    [plotId]: { ...result, savedAt: new Date().toISOString() } };
  setState({ plots, project: { ...state.project, results },
             selectedClass:null, selectedConfidence:null });

  clearAnnotationInputs();
  updateProgress();
  renderPlotList();
  api.saveResult(state.project.id, plotId, result).catch(console.error);
  nextPlot();
}

async function _submitPixelPlot() {
  const plotIdx = state.currentIndex;
  const p       = state.plots[plotIdx];
  const plotId  = p.id;

  const total = _subPointTotal();
  const spRes = state.subPointResults[plotId] || {};
  if (Object.keys(spRes).length < total) return;

  const agg    = computePlotLabel(plotId);
  if (!agg) return;

  const annotations = readAnnotationInputs();
  const { source: imageSource, date: imageDate } = _readActiveImageSource();
  const result = {
    code:        agg.code,
    label:       agg.label,
    confidence:  state.selectedConfidence,
    annotations,
    imageSource,
    imageDate,
    subPoints:   Object.entries(spRes).map(([idx, v]) => ({ idx: Number(idx), ...v })),
  };

  const plots = [...state.plots];
  plots[plotIdx] = { ...plots[plotIdx], resultCode:result.code, resultLabel:result.label,
                     confidence:result.confidence, annotations, completed:true };
  const results = { ...(state.project.results || {}),
                    [plotId]: { ...result, savedAt: new Date().toISOString() } };
  setState({ plots, project: { ...state.project, results },
             selectedClass:null, selectedConfidence:null, selectedSubPointIdx:null });

  clearAnnotationInputs();
  updateProgress();
  renderPlotList();
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
    const { id } = await api.createProject('Demo Project', molcaClasses, file, { assessmentMode:'point' });
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
    e.preventDefault();
    submitClassification();
  }
  if (e.key === 'h') setConfidence('High');
  if (e.key === 'm') setConfidence('Medium');
  if (e.key === 'l') setConfidence('Low');
});

// ── Expose on window.app (for HTML onclick handlers) ─────────────────────
window.app = {
  openCreateProjectModal, closeCreateProjectModal, createNewProject, onPresetChange,
  onCreateAssessModeChange,
  setProjectSort, showProjectListView, deleteCurrentProject,
  importProjectFile, onImportProjectFile, exportProjectFile, loadDemoData,
  goToPlot, nextPlot, prevPlot, filterPlots,
  toggleSplitView,
  switchBasemap:       (name)       => { switchBasemap(name);       _updateImageSourceDisplay(); },
  setMapLayer:         (side, name) => { setMapLayer(side, name);   _updateImageSourceDisplay(); },
  updateEsriYear:      ()           => { updateEsriYear();          _updateImageSourceDisplay(); },
  updateSentinel2Year: ()           => { updateSentinel2Year();     _updateImageSourceDisplay(); },
  updatePlanetParams:  ()           => { updatePlanetParams();      _updateImageSourceDisplay(); },
  selectClass, setConfidence, submitClassification,
  selectSubPoint, computePlotLabel,
  openSettings, closeSettings, saveSettings, clearKey,
  openProjectSettings, closeProjectSettings, saveProjectSettings,
  onSettingsAssessModeChange,
  openClassEditor, closeClassEditor, saveClassSchema, saveSchemaAsPreset,
  addEditorClass, applyEditorPreset, exportClassSchema, importClassSchema,
  openAnnotationFieldsEditor, closeAnnotationFieldsEditor,
  addAnnotationField, saveAnnotationFields,
  exportCSV, exportGeoJSON,
  openGoogleEarth, onGeRangeInput, toggleGepMode, onGepYearInput,
  toggleNdviPanel, openNdviPanel, closeNdviPanel,
  fetchNdvi, refreshNdvi, saveNdviGuide, resetNdviGuide,
  toggleNdviGuide, onNdviYearChange,
};

// ── Start ─────────────────────────────────────────────────────────────────
init();
