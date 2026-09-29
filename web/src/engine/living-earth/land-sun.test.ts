import { describe, expect, it } from 'vitest';
import { className, LAND_CLASSES, paletteArray } from './land-classes';
import { atMonth, subsolarPoint } from './sun';

describe('land classes', () => {
  it('follows the pack contract order', () => {
    expect(LAND_CLASSES).toHaveLength(12);
    expect(className(1)).toBe('Forest');
    expect(className(6)).toBe('Bare ground');
    expect(className(99)).toBe('Unknown');
  });

  it('never uses animal amber at full strength', () => {
    const p = paletteArray();
    for (let i = 0; i < LAND_CLASSES.length; i++) {
      const [r, g, b] = [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
      const amberLike = r > 0.9 && g > 0.6 && g < 0.8 && b < 0.5;
      expect(amberLike).toBe(false);
    }
  });
});

describe('sun', () => {
  it('stands over the Tropic of Cancer at the June solstice and the equator at the equinox', () => {
    expect(subsolarPoint(new Date(Date.UTC(2026, 5, 21, 12))).lat).toBeCloseTo(23.4, 0);
    expect(Math.abs(subsolarPoint(new Date(Date.UTC(2026, 2, 20, 12))).lat)).toBeLessThan(0.6);
    expect(subsolarPoint(new Date(Date.UTC(2026, 11, 21, 12))).lat).toBeCloseTo(-23.4, 0);
  });

  it('is over Greenwich near noon UTC', () => {
    expect(Math.abs(subsolarPoint(new Date(Date.UTC(2026, 3, 15, 12))).lng)).toBeLessThan(4);
  });

  it('moves the date to the chosen month, keeping the time of day', () => {
    const d = atMonth(new Date(Date.UTC(2026, 8, 29, 18, 30)), 6.5);
    expect(d.getUTCMonth()).toBe(6);
    expect(d.getUTCHours()).toBe(18);
  });
});
