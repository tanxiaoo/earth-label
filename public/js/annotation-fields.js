import { state, setState } from './state.js';
import * as api from './api.js';

const DEFAULT_FIELDS = [{ key: 'notes', label: 'Notes', type: 'text' }];
const KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;
const RESERVED_KEYS = new Set([
  'plotid','lat','lon','ref_code','ref_label',
  'class_code','class_label','confidence',
]);
const TYPES = [
  { value: 'text',   label: 'Text' },
  { value: 'binary', label: 'Yes / No' },
];

// ── Read helpers ──────────────────────────────────────────────────────────

export function getAnnotationFields() {
  const f = state.project?.annotationFields;
  return (Array.isArray(f) && f.length) ? f : DEFAULT_FIELDS;
}

// Returns the set of meta column headers used across all plots — used to
// reject editor keys that would collide with an upload's meta column.
function metaKeys() {
  const set = new Set();
  for (const p of state.plots || []) {
    for (const k of Object.keys(p.meta || {})) set.add(k.toLowerCase());
  }
  return set;
}

// ── Sidebar renderer ──────────────────────────────────────────────────────

// Render one input per annotation field for the currently-active plot.
// Existing values come from plot.annotations[field.key]; missing values are
// left blank. Called from goToPlot() (after navigating) and after editor save.
export function renderAnnotationInputs(plot) {
  const container = document.getElementById('annotationsContainer');
  if (!container) return;
  container.innerHTML = '';

  const fields = getAnnotationFields();
  const values = plot?.annotations || {};

  fields.forEach(f => {
    const wrap = document.createElement('div');
    wrap.className = 'annotation-field';

    const lbl = document.createElement('label');
    lbl.textContent = f.label;
    lbl.className = 'annotation-label';
    wrap.appendChild(lbl);

    if (f.type === 'text') {
      const ta = document.createElement('textarea');
      ta.dataset.fieldKey = f.key;
      ta.dataset.fieldType = 'text';
      ta.placeholder = 'Optional…';
      ta.value = values[f.key] ?? '';
      wrap.appendChild(ta);
    } else if (f.type === 'binary') {
      const row = document.createElement('div');
      row.className = 'binary-row';
      row.dataset.fieldKey = f.key;
      row.dataset.fieldType = 'binary';
      const current = values[f.key] ?? '';
      ['yes', 'no'].forEach(val => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `bin-btn ${current === val ? 'selected' : ''}`;
        btn.dataset.value = val;
        btn.textContent = val === 'yes' ? 'Yes' : 'No';
        btn.onclick = () => {
          const isSelected = btn.classList.contains('selected');
          row.querySelectorAll('.bin-btn').forEach(b => b.classList.remove('selected'));
          if (!isSelected) btn.classList.add('selected');
        };
        row.appendChild(btn);
      });
      wrap.appendChild(row);
    }

    container.appendChild(wrap);
  });
}

// Read current input values from the DOM. Returns { [key]: stringValue }.
// Binary fields with no selection → empty string.
export function readAnnotationInputs() {
  const container = document.getElementById('annotationsContainer');
  const out = {};
  if (!container) return out;
  container.querySelectorAll('[data-field-key]').forEach(el => {
    const key = el.dataset.fieldKey;
    const type = el.dataset.fieldType;
    if (type === 'text') {
      out[key] = el.value || '';
    } else if (type === 'binary') {
      const sel = el.querySelector('.bin-btn.selected');
      out[key] = sel ? sel.dataset.value : '';
    }
  });
  return out;
}

// Clear all annotation inputs to their empty state.
export function clearAnnotationInputs() {
  const container = document.getElementById('annotationsContainer');
  if (!container) return;
  container.querySelectorAll('textarea[data-field-key]').forEach(el => { el.value = ''; });
  container.querySelectorAll('.binary-row .bin-btn.selected').forEach(el => el.classList.remove('selected'));
}

// ── Editor modal ──────────────────────────────────────────────────────────

let _editingFields = [];
// Sidecar UI state, aligned by index with _editingFields. `false` means the
// label is still mirroring the key; the moment the user edits the label, the
// row flips to `true` and the mirror stops for that row.
let _labelTouched = [];

export function openAnnotationFieldsEditor() {
  _editingFields = JSON.parse(JSON.stringify(getAnnotationFields()));
  _labelTouched = _editingFields.map(f => f.label !== f.key);
  _renderEditorList();
  _setEditorError('');
  document.getElementById('annotationFieldsEditorModal').classList.remove('hidden');
}

export function closeAnnotationFieldsEditor() {
  document.getElementById('annotationFieldsEditorModal').classList.add('hidden');
}

function _renderEditorList() {
  const container = document.getElementById('annotationFieldsEditorList');
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'annotation-editor-header';
  header.innerHTML = `
    <div class="key-input">Column name (CSV)</div>
    <div class="label-input">Display label</div>
    <div class="type-input">Type</div>
    <div class="del-btn-spacer"></div>`;
  container.appendChild(header);

  if (_editingFields.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:12px;font-size:12px;color:var(--text-dim);text-align:center;';
    empty.textContent = 'No fields. Plots will have no annotation inputs. Add one below.';
    container.appendChild(empty);
    return;
  }

  _editingFields.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'annotation-editor-row';
    const typeOptions = TYPES.map(t =>
      `<option value="${t.value}" ${f.type === t.value ? 'selected' : ''}>${t.label}</option>`
    ).join('');
    row.innerHTML = `
      <input type="text" class="key-input" value="${_attr(f.key)}" placeholder="key (snake_case)"
             title="CSV column name" oninput="_editAnnoField(${i},'key',this.value)">
      <input type="text" class="label-input" value="${_attr(f.label)}" placeholder="Label"
             title="Label shown in the sidebar" oninput="_editAnnoField(${i},'label',this.value)">
      <select class="type-input" onchange="_editAnnoField(${i},'type',this.value)">
        ${typeOptions}
      </select>
      <button class="del-btn" onclick="_deleteAnnoField(${i})">✕</button>
    `;
    container.appendChild(row);
  });

  window._editAnnoField = (i, field, val) => {
    _editingFields[i][field] = val;
    if (field === 'key' && !_labelTouched[i]) {
      _editingFields[i].label = val;
      // Sync the label input's visible value too — the user is typing into the
      // key input, so the label's onchange has not fired.
      const labelInputs = document.querySelectorAll('#annotationFieldsEditorList .annotation-editor-row .label-input');
      if (labelInputs[i]) labelInputs[i].value = val;
    } else if (field === 'label') {
      _labelTouched[i] = true;
    }
  };
  window._deleteAnnoField = (i) => {
    const f = _editingFields[i];
    const hasData = _fieldHasStoredData(f.key);
    if (hasData && !confirm(`Delete field "${f.key}"?\n\nThis field has stored values on one or more plots. The values stay in the project file on disk but will no longer appear in CSV/GeoJSON exports.`)) return;
    _editingFields.splice(i, 1);
    _labelTouched.splice(i, 1);
    _renderEditorList();
  };
}

function _attr(s) {
  return String(s ?? '').replace(/"/g, '&quot;');
}

export function addAnnotationField() {
  const base = 'field';
  let i = _editingFields.length + 1;
  let key = `${base}_${i}`;
  const taken = new Set(_editingFields.map(f => f.key));
  while (taken.has(key)) { i += 1; key = `${base}_${i}`; }
  _editingFields.push({ key, label: key, type: 'text' });
  _labelTouched.push(false);
  _renderEditorList();
}

function _fieldHasStoredData(key) {
  const results = state.project?.results || {};
  for (const r of Object.values(results)) {
    if (r?.annotations && r.annotations[key] != null && r.annotations[key] !== '') return true;
    // legacy single-notes case
    if (key === 'notes' && r?.notes) return true;
  }
  return false;
}

function _setEditorError(msg) {
  const el = document.getElementById('annotationFieldsEditorError');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

function _validate(fields) {
  const seen = new Set();
  const meta = metaKeys();
  for (let i = 0; i < fields.length; i += 1) {
    const f = fields[i];
    const key = (f.key || '').trim();
    const label = (f.label || '').trim();
    if (!KEY_RE.test(key)) return `Row ${i + 1}: key "${key}" must match a-z, 0-9, _ (start with a letter, max 31 chars).`;
    if (RESERVED_KEYS.has(key)) return `Row ${i + 1}: key "${key}" conflicts with a built-in column.`;
    if (seen.has(key)) return `Row ${i + 1}: key "${key}" is duplicated.`;
    if (meta.has(key.toLowerCase())) return `Row ${i + 1}: key "${key}" collides with an uploaded data column.`;
    if (!label) return `Row ${i + 1}: label is required.`;
    if (!TYPES.find(t => t.value === f.type)) return `Row ${i + 1}: type must be one of: ${TYPES.map(t => t.value).join(', ')}.`;
    seen.add(key);
  }
  return null;
}

export async function saveAnnotationFields() {
  if (!state.project) return;
  // Sync from DOM (oninput should already have done this, but be defensive).
  const rows = document.querySelectorAll('#annotationFieldsEditorList .annotation-editor-row');
  rows.forEach((row, i) => {
    if (!_editingFields[i]) return;
    _editingFields[i].key   = row.querySelector('.key-input').value.trim();
    _editingFields[i].label = row.querySelector('.label-input').value.trim();
    _editingFields[i].type  = row.querySelector('.type-input').value;
  });

  const err = _validate(_editingFields);
  if (err) { _setEditorError(err); return; }

  // Detect renamed keys vs. previously-saved fields and warn.
  const oldKeys = new Set(getAnnotationFields().map(f => f.key));
  const newKeys = new Set(_editingFields.map(f => f.key));
  const renamedOrAdded = [..._editingFields].filter(f => !oldKeys.has(f.key));
  const removed = [...oldKeys].filter(k => !newKeys.has(k));
  if ((renamedOrAdded.length || removed.length) && _hasAnyStoredAnnotations()) {
    const msg = 'Annotation field changes detected:\n' +
      (renamedOrAdded.length ? `  • new/renamed: ${renamedOrAdded.map(f => f.key).join(', ')}\n` : '') +
      (removed.length        ? `  • removed:     ${removed.join(', ')}\n` : '') +
      '\nExisting stored values are NOT migrated. Continue?';
    if (!confirm(msg)) return;
  }

  try {
    await api.updateProject(state.project.id, { annotationFields: _editingFields });
  } catch (e) {
    _setEditorError(`Save failed: ${e.message}`);
    return;
  }

  setState({ project: { ...state.project, annotationFields: JSON.parse(JSON.stringify(_editingFields)) } });
  closeAnnotationFieldsEditor();

  // Re-render the sidebar for the current plot, if any.
  const idx = state.currentIndex;
  if (idx >= 0 && state.plots[idx]) renderAnnotationInputs(state.plots[idx]);
  else renderAnnotationInputs(null);
}

function _hasAnyStoredAnnotations() {
  const results = state.project?.results || {};
  for (const r of Object.values(results)) {
    if (r?.annotations && Object.values(r.annotations).some(v => v != null && v !== '')) return true;
    if (r?.notes) return true;
  }
  return false;
}
