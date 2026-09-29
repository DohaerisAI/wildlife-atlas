import { describe, expect, it } from 'vitest';
import { INDIA_ONLY, loadedRegions, noListNote } from './coverage';
import type { CoverageManifest } from '../types';

const partial: CoverageManifest = {
  version: 1, generated: 't', cellSize: 1, complete: false,
  regions: [
    { id: 'south-asia', name: 'South Asia', status: 'loaded' },
    { id: 'africa', name: 'Africa and Arabia', status: 'loaded' },
    { id: 'europe', name: 'Europe and the Middle East', status: 'pending' },
  ],
};

describe('coverage manifest', () => {
  it('names the loaded regions and counts the rest', () => {
    expect(loadedRegions(partial)).toEqual(['South Asia', 'Africa and Arabia']);
    expect(noListNote(partial)).toBe('Species lists cover South Asia and Africa and Arabia for now; 1 more region is on the way. Elsewhere the globe shows the ranges of species recorded there.');
  });
  it('falls back to India for old bundles and says so when complete', () => {
    expect(noListNote(INDIA_ONLY)).toMatch(/^Species lists cover India for now\./);
    expect(noListNote({ ...partial, complete: true })).toBe('No bird records in this grid square yet.');
    expect(noListNote({ ...partial, regions: [] })).toMatch(/still loading/);
  });
});
