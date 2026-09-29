import { describe, expect, it } from 'vitest';
import { cellBounds, washValues } from './cell-layer';

describe('cell layer', () => {
  it('reads cell ids as south-west corners', () => {
    expect(cellBounds('18_73', 1)).toEqual({ west: 73, south: 18, east: 74, north: 19 });
    expect(cellBounds('bad', 1)).toBeNull();
  });
  it('washes each cell by its share of the peak month, absent cells stay clear', () => {
    const v = washValues({ a: { r: [0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, b: { r: [5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } }, 1);
    expect(v.get('a')).toBeCloseTo(1);
    expect(v.get('b')).toBeCloseTo(0.6);
    expect(washValues({ a: { r: [0, 10] } }, 0).has('a')).toBe(false);
    expect(washValues({}, 0).size).toBe(0);
  });
});
