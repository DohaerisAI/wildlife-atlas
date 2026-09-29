import { describe, expect, it } from 'vitest';
import type { CellDetail, SpeciesRange } from '../types';
import { placeSummary, reportedTier } from './place-summary';
import { speciesSummary } from './species-summary';

const on = (months: number[]) => Array.from({ length: 12 }, (_, i) => (months.includes(i + 1) ? 1 : 0));
const flat = (n: number) => new Array<number>(12).fill(n);

const CELL: CellDetail = {
  id: '26_94', total: flat(100),
  species: [
    { k: 'bulbul', p: 'resident', c: flat(30), m: on([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) },
    { k: 'falcon', p: 'passage', c: flat(20), m: on([10, 11]) },
    { k: 'wagtail', p: 'seasonal', c: flat(10), m: on([10, 11, 12, 1, 2, 3]) },
    { k: 'cuckoo', p: 'seasonal', c: flat(5), m: on([6, 7, 8, 9, 10]) },
    { k: 'goose', p: 'seasonal', c: flat(4), m: on([11, 12, 1]) },
  ],
};

describe('place summary', () => {
  it('groups by presence and says what each species is doing this month', () => {
    const s = placeSummary(CELL, 10);
    expect(s.groups.map((g) => g.presence)).toEqual(['resident', 'seasonal', 'passage']);
    const doing = Object.fromEntries(s.groups.flatMap((g) => g.rows).map((r) => [r.key, r.doing]));
    expect(doing).toEqual({ bulbul: 'resident', wagtail: 'arriving', cuckoo: 'leaving', falcon: 'passing' });
    expect(s.moving).toBe(3);
    expect(s.total).toBe(4);
    expect(s.records).toBe(100);
  });

  it('says how often each species is reported relative to the most-reported one', () => {
    const rows = Object.fromEntries(placeSummary(CELL, 10).groups.flatMap((g) => g.rows).map((r) => [r.key, r.reported]));
    expect(rows).toMatchObject({ bulbul: 'often', falcon: 'often', wagtail: 'often', cuckoo: 'sometimes' });
  });

  it('calls a handful of records rare whatever the ratio', () => {
    expect(reportedTier(2, 2)).toBe('rarely');
    expect(reportedTier(40, 100)).toBe('often');
    expect(reportedTier(10, 100)).toBe('sometimes');
    expect(reportedTier(4, 100)).toBe('rarely');
    expect(reportedTier(5, 0)).toBe('rarely');
  });

  it('wraps the year and charts richness per month', () => {
    const jan = placeSummary(CELL, 1);
    const doing = Object.fromEntries(jan.groups.flatMap((g) => g.rows).map((r) => [r.key, r.doing]));
    expect(doing.goose).toBe('leaving');
    expect(doing.wagtail).toBe('staying');
    expect(jan.richness[9]).toBe(4); // October
    expect(jan.richness[0]).toBe(3); // January: bulbul, wagtail, goose
  });
});

describe('species summary', () => {
  const range: SpeciesRange = {
    k: 'falcon',
    cells: {
      '50_120': { p: 'seasonal', r: [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0] },
      '-24_28': { p: 'seasonal', r: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1] },
      '26_94': { p: 'passage', r: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0] },
    },
  };
  const s = speciesSummary(range, 1);

  it('finds the peak month and where the species is centred each month', () => {
    expect(s.peakMonth).toBe(9);
    expect(s.centres[6]!.lat).toBeCloseTo(50.5, 3);
    expect(s.centres[0]!.lat).toBeCloseTo(-23.5, 3);
    expect(s.centres[2]).toBeNull();
    expect(s.shiftDeg).toBeCloseTo(74, 0);
  });

  it('calls a species with no resident cells migratory', () => {
    expect(s.behaviour).toBe('migratory');
    expect(s.cells[9]).toBe(1);
    expect(s.totalCells).toBe(3);
  });
});
