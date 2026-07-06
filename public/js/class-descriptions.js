// ── MOLCA class descriptions ──────────────────────────────────────────────
// Text mirrored from docs/MOLCA_Description.md, keyed by class label so the
// info popup can look a description up regardless of the class code. Labels are
// matched case-insensitively and trimmed.

const MOLCA_DESCRIPTIONS = {
  'forest': 'Areas dominated by trees with a canopy cover of more than 50% at the time of fullest development. A tree is a woody, perennial plant with a simple, well-defined stem, a more or less defined crown, and a minimum height of 5 m. This class includes all tree types regardless of leaf shape (broadleaf or needleleaf) and phenology (evergreen or deciduous). Snow/ice, open water, or built-up areas cover less than 50% of the surface.',
  'shrubland': 'Areas dominated by shrubs with a canopy cover of more than 50% at the time of fullest development. A shrub is a woody perennial plant with persistent woody stems, no defined main stem, and a height of less than 5 m. This class includes both evergreen shrubs (never entirely without green foliage) and deciduous shrubs (leafless for part of the year). Snow/ice, open water, or built-up areas cover less than 50% of the surface.',
  'grassland': 'Areas dominated by herbaceous vegetation with a cover of more than 50% at the time of fullest development. Herbaceous plants are defined as plants without persistent stems or shoots above ground and lacking definite firm structures. Snow/ice, open water, or built-up areas cover less than 50% of the surface.',
  'cropland': 'Areas dominated by herbaceous plants that are sowed/planted and harvestable at least once within 12 months after the sowing/planting date, covering more than 50% of the surface. This includes rainfed crops, irrigated crops, aquatic crops, and annual pastures, following an adaptation of the JECAM cropland definition. Permanent woody crops (plantations) are excluded and fall under tree or shrub classes. Snow/ice, open water, or built-up areas cover less than 50%.',
  'wetland': 'Areas covered by vegetation (trees, shrubs, grasslands, or lichens and mosses) for more than 50% of the surface, flooded by water for more than 4 months throughout the year. The water can be saline, fresh, or brackish. This class encompasses both woody-dominated flooded areas and herbaceous-dominated flooded areas.',
  'lichens and mosses': 'Areas dominated by lichens and/or mosses with a cover of more than 50% at the time of fullest development. Mosses are photo-autotrophic land plants without true leaves, stems, or roots. Lichens are composite organisms formed from the symbiotic association of fungi and algae. Snow/ice, open water, or built-up areas cover less than 50% of the surface.',
  'bareland': 'Areas where the sum of vegetation cover is less than 50% at the time of fullest development. This includes bare rock, sand, deserts, extraction sites (open mines and quarries), and salt flats covered by water for less than 5 months. Snow/ice, open water, or built-up areas cover less than 50% of the surface.',
  'built-up': 'Areas where any predominant type of linear or non-linear artificial surface covers at least 50%. This includes buildings, roads, airports, greenhouses, and similar structures, but may exclude temporary settlements. Snow/ice and open water cover less than 50% of the surface.',
  'water': 'Areas where open water covers at least 50% of the surface. This includes both seasonal water (present between 5 and 9 months per year) and permanent water (present for more than 9 months per year). Water bodies can be natural or artificial, and the water can be saline, fresh, or brackish. Snow/ice and built-up areas cover less than 50%.',
  'permanent ice and snow': 'Areas where snow and/or ice cover at least 50% of the surface for more than 9 months per year. Built-up areas and open water cover less than 50% of the surface.',
};

// Returns the description string for a class label, or null if none is known.
export function getClassDescription(label) {
  if (!label) return null;
  return MOLCA_DESCRIPTIONS[label.trim().toLowerCase()] || null;
}

// True when a label has an associated description (used to decide whether to
// render the info icon at all).
export function hasClassDescription(label) {
  return getClassDescription(label) != null;
}

// Show the description popup for a given class label.
export function showClassDescription(label) {
  const desc = getClassDescription(label);
  if (!desc) return;
  document.getElementById('classDescTitle').textContent = label;
  document.getElementById('classDescBody').textContent = desc;
  document.getElementById('classDescModal').classList.remove('hidden');
}

export function closeClassDescription() {
  document.getElementById('classDescModal').classList.add('hidden');
}
