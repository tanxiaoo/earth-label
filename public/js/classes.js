import { state, setState } from './state.js';
import * as api from './api.js';

// ── Render class buttons in the right panel ───────────────────────────────
export function renderClassButtons() {
  const schema = state.project?.classSchema || [];
  const list = document.getElementById('classList');
  list.innerHTML = '';

  if (schema.length === 0) {
    list.innerHTML = '<div style="padding:16px;text-align:center;font-size:12px;color:var(--text-dim);">No classes defined.<br><button class="basemap-btn" style="margin-top:8px;" onclick="app.openClassEditor()">+ Add Classes</button></div>';
    return;
  }

  schema.forEach(cls => {
    const btn = document.createElement('button');
    btn.className = `class-btn ${state.selectedClass === cls.code ? 'selected' : ''}`;
    btn.onclick = () => window.app.selectClass(cls.code, cls.label);
    btn.innerHTML = `
      <div class="class-swatch" style="background:${cls.color}"></div>
      <span style="flex:1;text-align:left;">${cls.label}</span>
      ${cls.key ? `<span class="class-key">${cls.key}</span>` : ''}
    `;
    list.appendChild(btn);
  });
}

// ── Class Editor Modal ────────────────────────────────────────────────────

let _editingSchema = [];

export function openClassEditor() {
  _editingSchema = JSON.parse(JSON.stringify(state.project?.classSchema || []));
  _renderEditorList();
  _populateEditorPresets();
  document.getElementById('classEditorModal').classList.remove('hidden');
}

export function closeClassEditor() {
  document.getElementById('classEditorModal').classList.add('hidden');
}

function _populateEditorPresets() {
  const sel = document.getElementById('editorPresetSelect');
  sel.innerHTML = '<option value="">— select to overwrite —</option>';
  (state.presets || []).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

export async function applyEditorPreset() {
  const id = document.getElementById('editorPresetSelect').value;
  if (!id) return;
  const preset = await api.getPreset(id);
  _editingSchema = JSON.parse(JSON.stringify(preset.classes));
  _renderEditorList();
  document.getElementById('editorPresetSelect').value = '';
}

function _renderEditorList() {
  const container = document.getElementById('classEditorList');
  container.innerHTML = '';

  if (_editingSchema.length === 0) {
    container.innerHTML = '<div style="padding:12px;font-size:12px;color:var(--text-dim);text-align:center;">No classes. Add one below or load a preset.</div>';
    return;
  }

  _editingSchema.forEach((cls, i) => {
    const row = document.createElement('div');
    row.className = 'class-editor-row';
    row.innerHTML = `
      <input type="color" value="${cls.color}" title="Color"
             onchange="_editClass(${i},'color',this.value)">
      <input type="text" class="code-input" value="${cls.code}" placeholder="Code"
             title="Numeric code" onchange="_editClass(${i},'code',parseInt(this.value)||0)">
      <input type="text" class="label-input" value="${cls.label}" placeholder="Label"
             onchange="_editClass(${i},'label',this.value)">
      <input type="text" class="key-input" value="${cls.key || ''}" placeholder="Key"
             maxlength="1" title="Keyboard shortcut" onchange="_editClass(${i},'key',this.value)">
      <button class="del-btn" onclick="_deleteClass(${i})">✕</button>
    `;
    container.appendChild(row);
  });

  // Expose helpers on window so inline onchange handlers work
  window._editClass = (i, field, val) => { _editingSchema[i][field] = val; };
  window._deleteClass = (i) => { _editingSchema.splice(i, 1); _renderEditorList(); };
}

export function addEditorClass() {
  const nextCode = _editingSchema.length > 0
    ? Math.max(..._editingSchema.map(c => Number(c.code) || 0)) + 1
    : 1;
  _editingSchema.push({ code: nextCode, label: 'New Class', color: '#888888', key: '' });
  _renderEditorList();
}

export async function saveClassSchema() {
  if (!state.project) return;
  // Collect current values from DOM before reading _editingSchema
  // (onchange may not fire if user just saved; read inputs directly)
  const rows = document.querySelectorAll('#classEditorList .class-editor-row');
  rows.forEach((row, i) => {
    if (!_editingSchema[i]) return;
    _editingSchema[i].color = row.querySelector('input[type=color]').value;
    _editingSchema[i].code  = parseInt(row.querySelectorAll('input[type=text]')[0].value) || (i + 1);
    _editingSchema[i].label = row.querySelectorAll('input[type=text]')[1].value || 'Class';
    _editingSchema[i].key   = row.querySelectorAll('input[type=text]')[2].value || '';
  });

  await api.saveClassSchema(state.project.id, _editingSchema);
  setState({ project: { ...state.project, classSchema: _editingSchema } });
  renderClassButtons();
  closeClassEditor();
}

// ── Import/export class schema as CSV ─────────────────────────────────────
export function exportClassSchema() {
  const schema = _editingSchema.length ? _editingSchema : (state.project?.classSchema || []);
  const csv = 'code,label,color,key\n' + schema.map(c => `${c.code},"${c.label}",${c.color},${c.key || ''}`).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type:'text/csv' })),
    download: 'class_schema.csv',
  });
  a.click(); URL.revokeObjectURL(a.href);
}

export function importClassSchema(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const lines = e.target.result.trim().split(/\r?\n/).slice(1);
    _editingSchema = lines.map(line => {
      const [code, label, color, key] = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
      return { code: parseInt(code) || 0, label: label || 'Class', color: color || '#888888', key: key || '' };
    }).filter(c => c.label);
    _renderEditorList();
  };
  reader.readAsText(file);
  event.target.value = '';
}

// ── Schema preview chips in create-project modal ──────────────────────────
export function renderSchemaPreview(classes) {
  const el = document.getElementById('schemaPreview');
  el.innerHTML = classes.slice(0, 20).map(c =>
    `<div class="schema-chip"><div class="dot" style="background:${c.color}"></div>${c.label}</div>`
  ).join('') + (classes.length > 20 ? `<div class="schema-chip">+${classes.length - 20} more</div>` : '');
}
