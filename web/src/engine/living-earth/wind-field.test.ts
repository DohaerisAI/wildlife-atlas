import { describe, expect, it } from 'vitest';
import { advect, capPoint, sampleWind, windRate, type WindField } from './wind-field';
import { WIND } from './motion';

const LAYOUT = { cols: 4, rows: 3 };
const U = { lo: -15, hi: 15 };
const byteOf = (ms: number) => Math.round(((ms - U.lo) / (U.hi - U.lo)) * 255);

/** A 4x2-per-month field where every month blows `u` east and `v` north everywhere. */
function uniformField(perMonth: (m: number) => [number, number]): WindField {
  const w = 4; const h = 2;
  const data = new Uint8ClampedArray(w * LAYOUT.cols * h * LAYOUT.rows * 4);
  for (let m = 0; m < 12; m++) {
    const [u, v] = perMonth(m);
    const ox = (m % 4) * w; const oy = Math.floor(m / 4) * h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ((oy + y) * w * LAYOUT.cols + ox + x) * 4;
      data[i] = byteOf(u); data[i + 1] = byteOf(v); data[i + 3] = 255;
    }
  }
  return { data, atlasWidth: w * LAYOUT.cols, month: [w, h], layout: LAYOUT, u: U, v: U };
}

describe('wind field', () => {
  it('decodes u and v in m/s', () => {
    const f = uniformField(() => [10, -5]);
    const [u, v] = sampleWind(f, 30, 10, 3.5);
    expect(u).toBeCloseTo(10, 0);
    expect(v).toBeCloseTo(-5, 0);
  });

  it('blends neighbouring months at their mid-points', () => {
    const f = uniformField((m) => [m === 10 ? 12 : 0, 0]);
    expect(sampleWind(f, 0, 0, 10.5)[0]).toBeCloseTo(12, 0);
    expect(sampleWind(f, 0, 0, 11.0)[0]).toBeCloseTo(6, 0);
    expect(sampleWind(f, 0, 0, 11.5)[0]).toBeCloseTo(0, 0);
  });

  it('wraps across the dateline without a seam', () => {
    const f = uniformField(() => [5, 0]);
    expect(sampleWind(f, 179.9, 0, 1.5)[0]).toBeCloseTo(sampleWind(f, -179.9, 0, 1.5)[0], 3);
  });
});

describe('motion scale', () => {
  it('maps 15 m/s to 1.2 cells a second, in degrees', () => {
    expect(windRate(15)).toBeCloseTo(WIND.cellsPerS * WIND.cellDeg, 6);
    expect(windRate(0)).toBe(0);
  });

  it('moves with the wind, faster in longitude near the poles', () => {
    const [lng, lat] = advect(0, 0, 15, 0, 1);
    expect(lng).toBeCloseTo(1.2, 6);
    expect(lat).toBe(0);
    const [lngHigh] = advect(0, 60, 15, 0, 1);
    expect(lngHigh).toBeCloseTo(2.4, 3);
    expect(advect(179.5, 0, 15, 0, 1)[0]).toBeLessThan(-178);
  });
});

describe('spawning in view', () => {
  it('keeps points inside the visible cap', () => {
    const rad = (d: number) => (d * Math.PI) / 180;
    for (let i = 0; i < 200; i++) {
      const [lng, lat] = capPoint(80, 20, rad(30), (i * 0.618) % 1, (i * 0.377) % 1);
      const cos = Math.sin(rad(lat)) * Math.sin(rad(20)) + Math.cos(rad(lat)) * Math.cos(rad(20)) * Math.cos(rad(lng - 80));
      expect(Math.acos(Math.min(1, cos))).toBeLessThanOrEqual(rad(30) + 1e-6);
    }
  });
});
