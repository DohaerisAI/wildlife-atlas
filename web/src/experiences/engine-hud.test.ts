import { describe, expect, it } from 'vitest';
import { formatAlt, frameSummary } from './engine-hud';

describe('engine HUD', () => {
  it('summarises frame times', () => {
    const s = frameSummary([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 50]);
    expect(s.mean).toBeCloseTo(12);
    expect(s.p95).toBe(50);
    expect(frameSummary([])).toEqual({ mean: 0, p95: 0 });
  });
  it('formats altitude for every scale', () => {
    expect(formatAlt(20000)).toBe('20,000 km');
    expect(formatAlt(50)).toBe('50.0 km');
    expect(formatAlt(5.123)).toBe('5.12 km');
  });
});
