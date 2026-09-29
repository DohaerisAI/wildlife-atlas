import { describe, expect, it } from 'vitest';
import { landTint, rowLatitudes } from './land-tint';

describe('street map land tint', () => {
  it('spaces rows in Mercator, stretched toward the poles', () => {
    const lats = rowLatitudes(100);
    expect(lats[0]).toBeGreaterThan(79);
    expect(lats[49]! + lats[50]!).toBeCloseTo(0, 6);
    expect(lats[0]! - lats[1]!).toBeLessThan(lats[49]! - lats[50]!);
  });

  it('leaves the sea clear and greens forest with the month', () => {
    // land: west half ocean (class 0), east half forest (class 1), flat hillshade
    const land = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 181, 255, 1, 80, 181, 255]) };
    const surfData = (ndviByte: number) => {
      const d = new Uint8ClampedArray(2 * 4 * 1 * 3 * 4);
      for (let i = 0; i < d.length; i += 4) d[i + 2] = ndviByte;
      return { data: d, atlasWidth: 8, month: [2, 1] as const, layout: { cols: 4, rows: 3 } };
    };
    const palette = new Float32Array(36);
    palette.set([0.2, 0.9, 0.5], 3);
    const src = (b: number) => ({ land, surface: surfData(b), ndvi: { lo: -0.2, hi: 0.9 }, palette });
    const wet = landTint(src(230), 6.5, 2, 1);
    const dry = landTint(src(60), 6.5, 2, 1);
    expect(wet[3]).toBe(0); // ocean pixel transparent
    expect(wet[7]).toBe(255);
    expect(wet[5]!).toBeGreaterThan(dry[5]!); // greener in the wet month
  });
});
