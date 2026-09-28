import { describe, expect, it } from 'vitest';
import type { SpeciesRange } from '../types';
import { buildFlow } from './flow';
import { flockCenter, glide, toLngLat, toVec } from './follow';

const z = () => new Array(12).fill(0);
const range: SpeciesRange = {
  k: 'x',
  cells: {
    '50_120': { r: [0, 0, 0, 0, 0.2, 0.2, 0.2, 0, 0, 0, 0, 0], p: 'seasonal' }, // NE Asia, summer
    '-25_28': { r: [0.2, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2], p: 'seasonal' }, // South Africa, winter
  },
};

describe('follow camera', () => {
  const flow = buildFlow(range, 1, 300, 5);

  it('centres on the summer flock', () => {
    const c = toLngLat(flockCenter(flow, 5.5)!);
    expect(c.lat).toBeGreaterThan(49);
    expect(c.lng).toBeGreaterThan(119);
  });

  it('centres on the winter flock', () => {
    const c = toLngLat(flockCenter(flow, 0.5)!);
    expect(c.lat).toBeLessThan(-23);
    expect(c.lng).toBeLessThan(30);
  });

  it('returns null when the species is absent', () => {
    const empty = buildFlow({ k: 'e', cells: { '0_0': { r: z(), p: 'uncertain' } } }, 1, 10);
    expect(flockCenter(empty, 3)).toBeNull();
  });

  it('handles flocks across the antimeridian', () => {
    const wrap = buildFlow({ k: 'w', cells: { '10_179': { r: new Array(12).fill(0.1), p: 'resident' }, '10_-180': { r: new Array(12).fill(0.1), p: 'resident' } } }, 1, 200, 2);
    expect(Math.abs(toLngLat(flockCenter(wrap, 3)!).lng)).toBeGreaterThan(178);
  });

  it('glides toward the target without overshooting', () => {
    const a = toVec(0, 0);
    const b = toVec(90, 0);
    const half = toLngLat(glide(a, b, 0.5));
    expect(half.lng).toBeGreaterThan(0);
    expect(half.lng).toBeLessThan(90);
    expect(toLngLat(glide(a, b, 100)).lng).toBeCloseTo(90, 3);
  });
});
