import { describe, expect, it } from 'vitest';
import { cellBounds, WASH_SCALE, washGrid, washValues } from './cell-layer';

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
  it('spreads each cell softly at WASH_SCALE texels per cell, north row first, absent far away', () => {
    const g = washGrid(new Map([['18_73', 1]]), 1);
    expect([g.cols, g.rows]).toEqual([360 * WASH_SCALE, 180 * WASH_SCALE]);
    const at = (lat: number, lng: number) => g.data[Math.floor((90 - lat) * WASH_SCALE) * g.cols + Math.floor((lng + 180) * WASH_SCALE)]!;
    expect(at(18.5, 73.5)).toBeGreaterThan(110); // a lone cell keeps about half at its centre
    expect(at(18.5, 74.2)).toBeGreaterThan(0); // and fades into its neighbour instead of a hard edge
    expect(at(18.5, 76)).toBe(0); // gone a few cells away
    expect(washGrid(new Map(), 1).data.every((b) => b === 0)).toBe(true);
  });
});
