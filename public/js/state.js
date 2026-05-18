export const state = {
  project:          null,   // full project object from server
  plots:            [],     // project.plots array (normalised with result merged in)
  currentIndex:     -1,
  selectedClass:    null,   // class code (number)
  selectedConfidence: null,
  currentFilter:    'all',
  projectSort:      'recent',
  isSplitMode:      false,
  leftBasemap:      'google',
  rightBasemap:     'sentinel2',
  isFirstPlotLoad:  true,
  presets:          [],     // cached from /api/presets
  geRange:          Number(localStorage.getItem('geRange')) || 1000,  // meters; GE Pro + GE Web zoom distance
  ndviPanelOpen:    false,  // floating NDVI panel visibility (no API calls when false)

  // ── Assessment / UA settings (loaded from project, persisted server-side) ──
  // assessmentMode: "point" → classify each plot entry directly (no UA square)
  //                 "pixel" → CEO methodology: UA square + sub-point grid
  assessmentMode:       'point',
  plotSizeM:            30,      // UA square side length in meters (pixel mode)
  subPointGrid:         '5x5',   // "3x3" (9 pts) | "5x5" (25 pts)
  aggregationRule:      'majority', // "majority" | "threshold"
  aggregationThreshold: 0.5,     // fraction needed to win (threshold rule)

  // ── Sub-point tracking (pixel mode, ephemeral — not persisted) ──
  selectedSubPointIdx:  null,    // idx of the currently active sub-point
  subPointResults:      {},      // {plotId: {idx: {code, label}}}

  // ── Google Earth Pro source tracking ──────────────────────────────────────
  gepActive: false,
  gepYear:   '',

  // ── Per-point timer (ephemeral — not persisted) ───────────────────────────
  timerStartedAt:     null,  // Date.now() of current segment start; null = not running
  timerAccumulatedMs: 0,     // ms banked before current segment (handles pause/resume)
  timerPaused:        false,
};

export function setState(updates) {
  Object.assign(state, updates);
}
