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
  googleEarthActive: false,
  geWindowRef:      null,
  presets:          [],     // cached from /api/presets
};

export function setState(updates) {
  Object.assign(state, updates);
}
