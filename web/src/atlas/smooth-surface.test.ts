import { describe, expect, it } from 'vitest';
import { surfaceGrid, surfaceImage } from './smooth-surface';

describe('smooth surface', () => {
  it('pads the grid by one cell on every side', () => {
    const g = surfaceGrid(['10_70', '12_72'], 1)!;
    expect(g).toMatchObject({ latMin: 9, lngMin: 69, rows: 5, cols: 5 });
  });

  it('returns null for no cells', () => {
    expect(surfaceGrid([], 1)).toBeNull();
  });

  it('is full strength at a cell centre, blends between centres and fades to empty padding', () => {
    const g = surfaceGrid(['10_70', '10_71'], 1)!;
    const img = surfaceImage(g, (id) => ({ '10_70': 1, '10_71': 0.5 } as Record<string, number>)[id] ?? 0, [255, 178, 107]);
    expect(img.width).toBe(32);
    const mid = img.height / 2; // centre row of the one data row, 8 px per cell
    const alphaAt = (px: number, py = mid) => img.data[(py * img.width + px) * 4 + 3]!;
    // pixel 12 sits at 1.5625 cells, just past the first centre (1.5); 20 just past the second (2.5)
    expect(alphaAt(12)).toBeGreaterThan(245);
    expect(alphaAt(20)).toBeGreaterThan(120);
    expect(alphaAt(20)).toBeLessThan(135);
    expect(alphaAt(16)).toBeGreaterThan(alphaAt(20));
    expect(alphaAt(16)).toBeLessThan(alphaAt(12));
    expect(alphaAt(0)).toBe(0);
    expect(alphaAt(12, 0)).toBe(0);
    expect(img.data[(mid * img.width + 12) * 4]).toBe(255);
  });

  it('spans the padded bounds', () => {
    const g = surfaceGrid(['10_70'], 1)!;
    expect(surfaceImage(g, () => 0, [0, 0, 0]).coordinates).toEqual([[69, 12], [72, 12], [72, 9], [69, 9]]);
  });

  it('clamps out-of-range values', () => {
    const g = surfaceGrid(['10_70'], 1)!;
    const img = surfaceImage(g, () => 7, [0, 0, 0]);
    expect(Math.max(...img.data.filter((_, i) => i % 4 === 3))).toBe(255);
  });
});
