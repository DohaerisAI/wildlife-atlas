import type { CoverageManifest } from '../types';

/** Used when a bundle has no coverage.json (the India-only bundles built before it existed). */
export const INDIA_ONLY: CoverageManifest = {
  version: 1, generated: '', cellSize: 1, complete: false,
  regions: [{ id: 'india', name: 'India', status: 'loaded' }],
};

function list(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Names of the regions whose species lists are loaded, in publishing order. */
export function loadedRegions(m: CoverageManifest): string[] {
  return m.regions.filter((r) => r.status === 'loaded').map((r) => r.name);
}

/** What the place panel says where a point has no species list, from the coverage manifest. */
export function noListNote(m: CoverageManifest): string {
  if (m.complete) return 'No bird records in this grid square yet.';
  const loaded = loadedRegions(m);
  if (!loaded.length) return 'Species lists are still loading region by region.';
  const pending = m.regions.filter((r) => r.status !== 'loaded').length;
  return `Species lists cover ${list(loaded)} for now${pending ? `; ${pending} more ${pending === 1 ? 'region is' : 'regions are'} on the way` : ''}. Elsewhere the globe shows the ranges of species recorded there.`;
}
