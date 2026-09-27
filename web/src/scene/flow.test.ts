import { describe, expect, it } from 'vitest';
import type { SpeciesRange } from '../types';
import { buildFlow, cellIntensity, easeInOut, massAt, monthBlend, sampleFlow } from './flow';
import { hilbertIndex } from './rng';

const z = () => new Array(12).fill(0);
// Winter in the south cell, summer in the north cell, absent in July.
const range: SpeciesRange = {
  k: 'x',
  cells: {
    '10_76': { r: [0.2, 0.2, 0.2, 0, 0, 0, 0, 0, 0, 0.2, 0.2, 0.2], p: 'seasonal' },
    '28_77': { r: [0, 0, 0, 0.1, 0.1, 0.1, 0, 0.1, 0.1, 0, 0, 0], p: 'seasonal' },
  },
};

describe('buildFlow', () => {
  const flow = buildFlow(range, 1, 200, 3);

  it('normalizes monthly mass to peak', () => {
    expect(flow.mass[0]).toBeCloseTo(1);
    expect(flow.mass[3]).toBeCloseTo(0.5);
    expect(flow.mass[6]).toBe(0);
  });

  it('places particles inside the occupied cells', () => {
    const jan = flow.positions[0]!;
    for (let i = 0; i < 200; i++) {
      expect(jan[i * 2]).toBeGreaterThanOrEqual(76);
      expect(jan[i * 2]).toBeLessThan(77);
      expect(jan[i * 2 + 1]).toBeGreaterThanOrEqual(10);
      expect(jan[i * 2 + 1]).toBeLessThan(11);
    }
    expect(flow.positions[4]![1]).toBeGreaterThanOrEqual(28);
  });

  it('keeps particles in place for an empty month', () => {
    expect(flow.positions[6]).toBe(flow.positions[5]);
  });

  it('is deterministic per seed', () => {
    expect(buildFlow(range, 1, 50, 9).positions[0]).toEqual(buildFlow(range, 1, 50, 9).positions[0]);
  });

  it('handles a species with no presence', () => {
    const empty = buildFlow({ k: 'e', cells: { '10_76': { r: z(), p: 'uncertain' } } }, 1, 10);
    expect(Array.from(empty.mass)).toEqual(z());
  });
});

describe('sampleFlow', () => {
  const flow = buildFlow(range, 1, 100, 3);
  const out = new Float32Array(300);

  it('matches month positions at mid-month when wobble is off', () => {
    sampleFlow(flow, 0.5, out, 0);
    expect(out[0]).toBeCloseTo(flow.positions[0]![0]!);
  });

  it('moves particles between months', () => {
    sampleFlow(flow, 3.0, out, 0);
    expect(out[1]).toBeGreaterThan(11);
    expect(out[1]).toBeLessThan(28);
  });

  it('hides all particles when the species is absent', () => {
    sampleFlow(flow, 6.5, out, 0);
    for (let i = 0; i < 100; i++) expect(out[i * 3 + 2]).toBe(0);
  });

  it('shows roughly half the particles at half mass', () => {
    sampleFlow(flow, 4.5, out, 0);
    let visible = 0;
    for (let i = 0; i < 100; i++) visible += out[i * 3 + 2]! > 0.5 ? 1 : 0;
    expect(visible).toBeGreaterThan(30);
    expect(visible).toBeLessThan(70);
  });

  it('wraps December to January', () => {
    sampleFlow(flow, 0.3, out, 0);
    expect(out[1]).toBeLessThan(11.2);
  });
});

describe('helpers', () => {
  it('eases monotonically from 0 to 1', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.25)).toBeLessThan(easeInOut(0.5));
  });

  it('anchors months at mid-month', () => {
    expect(monthBlend(9.5)).toEqual({ m0: 9, m1: 10, s: 0 });
    expect(monthBlend(0.2).m0).toBe(11);
  });

  it('mass follows the anchors', () => {
    const flow = buildFlow(range, 1, 10, 3);
    expect(massAt(flow, 3.5)).toBeCloseTo(0.5);
    expect(massAt(flow, 6.5)).toBe(0);
  });

  it('interpolates cell intensity', () => {
    const m = cellIntensity(range, 3.0, 0.2);
    expect(m.get('10_76')).toBeGreaterThan(0);
    expect(m.get('10_76')).toBeLessThan(1);
  });

  it('hilbert indices are unique on a small grid', () => {
    const seen = new Set<number>();
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) seen.add(hilbertIndex(8, x, y));
    expect(seen.size).toBe(64);
  });
});
