import { describe, expect, it } from 'vitest';
import { cellsPerMonth, peakRate, wildlifeHere } from './listing';
import type { CellDetail } from './types';

const zeros = () => new Array(12).fill(0);
const cell: CellDetail = {
  id: '10_76',
  total: new Array(12).fill(100),
  species: [
    { k: 'res', c: new Array(12).fill(10), p: 'resident', m: new Array(12).fill(1) },
    { k: 'res2', c: new Array(12).fill(30), p: 'resident', m: new Array(12).fill(1) },
    { k: 'win', c: [20, 20, 0, 0, 0, 1, 0, 0, 0, 5, 20, 20], p: 'seasonal', m: [1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1] },
    { k: 'unc', c: [0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0], p: 'uncertain', m: zeros() },
  ],
};

describe('wildlifeHere', () => {
  it('groups by presence in fixed order and ranks by share', () => {
    const groups = wildlifeHere(cell, 1);
    expect(groups.map((g) => g.presence)).toEqual(['resident', 'seasonal']);
    expect(groups[0]!.species.map((s) => s.key)).toEqual(['res2', 'res']);
    expect(groups[1]!.species[0]!.share).toBeCloseTo(0.2);
  });

  it('hides a seasonal species in a stray off-season month', () => {
    const keys = wildlifeHere(cell, 6).flatMap((g) => g.species.map((s) => s.key));
    expect(keys).not.toContain('win');
  });

  it('shows uncertain species only when recorded that month', () => {
    expect(wildlifeHere(cell, 5).map((g) => g.presence)).toContain('uncertain');
    expect(wildlifeHere(cell, 4).map((g) => g.presence)).not.toContain('uncertain');
  });

  it('handles a month with no effort', () => {
    const empty: CellDetail = { ...cell, total: zeros(), species: [] };
    expect(wildlifeHere(empty, 3)).toEqual([]);
  });
});

describe('range helpers', () => {
  const range = { a: { r: [0, 0.2, ...new Array(10).fill(0)] }, b: { r: [0.1, 0.5, ...new Array(10).fill(0)] } };
  it('finds peak rate', () => expect(peakRate(range)).toBe(0.5));
  it('counts cells per month', () => expect(cellsPerMonth(range).slice(0, 3)).toEqual([1, 2, 0]));
});
