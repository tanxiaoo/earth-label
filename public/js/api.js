// Central API client — all backend calls go through here

async function _json(res) {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Keys
export const getKeyStatus  = ()       => fetch('/api/keys/status').then(_json);
export const saveKeys      = (body)   => fetch('/api/keys', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }).then(_json);
export const deleteKeys    = (body)   => fetch('/api/keys', { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }).then(_json);

// Presets
export const listPresets   = ()       => fetch('/api/presets').then(_json);
export const getPreset     = (id)     => fetch(`/api/presets/${id}`).then(_json);
export const savePreset    = (name, classes, description) =>
  fetch('/api/presets', { method:'POST', headers:{'Content-Type':'application/json'},
                          body: JSON.stringify({ name, classes, description }) }).then(_json);
export const deletePreset  = (id)     => fetch(`/api/presets/${id}`, { method:'DELETE' }).then(_json);

// Projects
export const listProjects  = ()       => fetch('/api/projects').then(_json);
export const loadProject   = (id)     => fetch(`/api/projects/${id}`).then(_json);
export const deleteProject = (id)     => fetch(`/api/projects/${id}`, { method:'DELETE' }).then(_json);

export async function createProject(name, classSchema, file, uaSettings) {
  const form = new FormData();
  form.append('name', name);
  form.append('classSchema', JSON.stringify(classSchema));
  form.append('uaSettings', JSON.stringify(uaSettings || {}));
  if (file) form.append('file', file);
  return fetch('/api/projects', { method:'POST', body:form }).then(_json);
}

export const updateProject = (id, body) =>
  fetch(`/api/projects/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }).then(_json);

export const saveResult = (projectId, plotId, result) =>
  updateProject(projectId, { plotId, result, lastUsed: new Date().toISOString() });

export const saveClassSchema = (projectId, classSchema) =>
  updateProject(projectId, { classSchema, lastUsed: new Date().toISOString() });

// Save UA / assessment settings for an existing project
export const saveProjectSettings = (projectId, uaSettings) =>
  updateProject(projectId, { uaSettings, lastUsed: new Date().toISOString() });

export async function parseFile(file) {
  const form = new FormData();
  form.append('file', file);
  return fetch('/api/projects/parse-file', { method:'POST', body:form }).then(_json);
}

export async function importProject(file) {
  const form = new FormData();
  form.append('file', file);
  return fetch('/api/projects/import', { method:'POST', body:form }).then(_json);
}

export const exportProjectUrl = (id) => `/api/projects/${id}/export`;

// KML update (Google Earth Pro). `pixelMode` is null in point mode, or
// { plotSizeM, subPointGrid, subPointResults[], selectedIdx } in pixel mode.
export const updateKML = (lat, lon, id, label, range, pixelMode = null) =>
  fetch('/kml/update', { method:'POST', headers:{'Content-Type':'application/json'},
                          body: JSON.stringify({ lat, lon, id, label, range, pixelMode }) }).catch(() => {});

export const updateKMLRange = (range) =>
  fetch('/kml/update', { method:'POST', headers:{'Content-Type':'application/json'},
                          body: JSON.stringify({ range }) }).catch(() => {});

// NDVI — Sentinel Hub monthly time series for a point
export const getNdviMonthly = (lat, lon, year = 2025) =>
  fetch('/api/ndvi/monthly', { method:'POST', headers:{'Content-Type':'application/json'},
                                body: JSON.stringify({ lat, lon, year }) }).then(_json);

export const saveNdviCache = (projectId, plotId, year, months) =>
  updateProject(projectId, {
    ndviCacheUpdate: { plotId, year, months },
    lastUsed: new Date().toISOString(),
  });

// Canopy height — ECHOSAT (10 m, 2018–2024) point value via Google Earth Engine
export const getCanopyHeight = (lat, lon, year = 2024) =>
  fetch('/api/canopy/point', { method:'POST', headers:{'Content-Type':'application/json'},
                                body: JSON.stringify({ lat, lon, year }) }).then(_json);

export const saveCanopyCache = (projectId, plotId, year, heightM) =>
  updateProject(projectId, {
    canopyCacheUpdate: { plotId, year, heightM },
    lastUsed: new Date().toISOString(),
  });
