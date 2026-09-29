import { describe, expect, it } from 'vitest';
import { greenness, readingLines, windFrom } from './reading';
import { sampleValue, type MonthlyPixels } from './sampler';

describe('environment reading', () => {
  it('names wind by where it blows from', () => {
    expect(windFrom(0, -5)).toBe('north'); // blowing south
    expect(windFrom(-5, -5)).toBe('north-east'); // the winter monsoon over the Arabian Sea
    expect(windFrom(5, 0)).toBe('west');
  });

  it('reads greenness in words', () => {
    expect(greenness(0.05)).toBe('bare or water');
    expect(greenness(0.72)).toBe('lush');
  });

  it('cites a dataset on every line, and shows land lines only on land', () => {
    const r = { windU: -5, windV: -5, tempC: 27.4, ndvi: 0.62, waterPct: 3, snowPct: 0 };
    const land = readingLines(r, true);
    expect(land.map((l) => l.label)).toEqual(['Wind', 'Air', 'Greenness', 'Water', 'Snow']);
    expect(land.every((l) => l.source.length > 0)).toBe(true);
    expect(land[0]!.value).toBe('7.1 m/s from the north-east');
    expect(readingLines(r, false)).toHaveLength(2);
  });
});

describe('atlas sampler', () => {
  it('decodes a channel for a month from the tile layout', () => {
    const w = 2; const h = 1;
    const data = new Uint8ClampedArray(w * 4 * h * 3 * 4);
    // March (index 2) is column 2, row 0: set its R byte to 255
    for (let x = 0; x < w; x++) data[(2 * w + x) * 4] = 255;
    const p: MonthlyPixels = { data, atlasWidth: w * 4, month: [w, h], layout: { cols: 4, rows: 3 } };
    expect(sampleValue(p, 0, { lo: 0, hi: 100 }, 10, 0, 2.5)).toBeCloseTo(100, 6);
    expect(sampleValue(p, 0, { lo: 0, hi: 100 }, 10, 0, 1.5)).toBeCloseTo(0, 6);
    expect(sampleValue(p, 0, { lo: 0, hi: 100 }, 10, 0, 2.0)).toBeCloseTo(50, 6);
  });
});
