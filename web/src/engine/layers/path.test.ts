import { describe, expect, it } from 'vitest';
import { geoPath } from './path';

describe('geoPath', () => {
  it('measures great-circle distance', () => {
    // a quarter of the equator is about 10,008 km
    expect(geoPath([[0, 0], [90, 0]]).km).toBeCloseTo(10008, -1);
  });

  it('interpolates along the path by distance', () => {
    const p = geoPath([[0, 0], [10, 0], [30, 0]]);
    expect(p.at(0.5)[0]).toBeCloseTo(15, 3);
    expect(p.fractionAt(1)).toBeCloseTo(1 / 3, 6);
    expect(p.at(1)[0]).toBeCloseTo(30, 6);
  });

  it('clamps progress outside 0..1', () => {
    const p = geoPath([[0, 0], [10, 0]]);
    expect(p.at(-1)[0]).toBeCloseTo(0, 6);
    expect(p.at(2)[0]).toBeCloseTo(10, 6);
  });

  it('rejects a single waypoint', () => {
    expect(() => geoPath([[0, 0]])).toThrow(/two waypoints/);
  });
});
