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
};

export function setState(updates) {
  Object.assign(state, updates);
}
