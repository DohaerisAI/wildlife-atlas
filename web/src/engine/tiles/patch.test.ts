import { describe, expect, it } from 'vitest';
import { patchArrays } from './patch';
import { tile } from './tile-math';

describe('tile patch', () => {
  it('has a grid plus a skirt, and every index points at a vertex', () => {
    const n = 4;
    const a = patchArrays(tile(6, 90, 25), n);
    const grid = (n + 1) ** 2; const skirt = 4 * n;
    expect(a.positions.length / 3).toBe(grid + skirt);
    expect(a.indices.length).toBe(n * n * 6 + skirt * 6);
    expect(Math.max(...a.indices)).toBeLessThan(grid + skirt);
  });

  it('grid vertices sit on the unit sphere, skirt vertices just below it', () => {
    const a = patchArrays(tile(3, 11, 3), 4);
    const r = (k: number) => Math.hypot(a.positions[k * 3]! + a.center[0], a.positions[k * 3 + 1]! + a.center[1], a.positions[k * 3 + 2]! + a.center[2]);
    expect(r(0)).toBeCloseTo(1, 6);
    expect(r(24)).toBeCloseTo(1, 6);
    expect(r(25)).toBeLessThan(1);
    expect(r(25)).toBeGreaterThan(0.99);
  });

  it('uv runs east and south from the north-west corner', () => {
    const a = patchArrays(tile(5, 45, 12), 2);
    expect([a.uvs[0], a.uvs[1]]).toEqual([0, 0]);
    expect([a.uvs[16], a.uvs[17]]).toEqual([1, 1]);
  });
});
