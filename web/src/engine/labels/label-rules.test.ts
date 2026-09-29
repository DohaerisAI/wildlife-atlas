import { describe, expect, it } from 'vitest';
import { boxSize, eligible, fade, labelSize, minPopulation, parseRows, placeLabels, priority, type Place } from './label-rules';

const pune: Place = { name: 'Pune', lng: 73.86, lat: 18.52, population: 3124458, kind: 2, admin1: 'Maharashtra', country: 'IN' };
const satna: Place = { ...pune, name: 'Satna', population: 282977, admin1: 'Madhya Pradesh' };
const village: Place = { ...pune, name: 'Amarpatan', population: 11000 };
const delhi: Place = { ...pune, name: 'New Delhi', population: 317797, kind: 0 };

describe('place label rules', () => {
  it('shows smaller places as the camera comes down', () => {
    expect(minPopulation(20000)).toBeGreaterThan(minPopulation(3000));
    expect(minPopulation(3000)).toBeGreaterThan(minPopulation(500));
    expect(minPopulation(10)).toBe(1000);
    expect(eligible(pune, 3000)).toBe(true);
    expect(eligible(satna, 3000)).toBe(false);
    expect(eligible(satna, 500)).toBe(true);
    expect(eligible(village, 50)).toBe(true);
    expect(eligible(village, 500)).toBe(false);
  });

  it('capitals rank and show early', () => {
    expect(priority(delhi)).toBeGreaterThan(priority(satna));
    expect(eligible(delhi, 6000)).toBe(true);
    expect(labelSize(delhi, 500)).toBe('l');
    expect(labelSize(village, 150)).toBe('s');
  });

  it('keeps the higher-priority label when two collide', () => {
    const a = { id: 'a', x: 100, y: 100, w: 60, h: 20, priority: 6 };
    const b = { id: 'b', x: 120, y: 105, w: 60, h: 20, priority: 5 };
    const c = { id: 'c', x: 400, y: 100, w: 60, h: 20, priority: 4 };
    expect([...placeLabels([b, a, c], 10)].sort()).toEqual(['a', 'c']);
    expect(placeLabels([a, c], 1)).toEqual(new Set(['a']));
  });

  it('sizes boxes from text and fades smoothly', () => {
    expect(boxSize('Satna', 'm').w).toBeLessThan(boxSize('Thiruvananthapuram', 'm').w);
    const f = fade(0, 1, 1 / 60);
    expect(f).toBeGreaterThan(0); expect(f).toBeLessThan(0.3);
    expect(fade(0, 1, 5)).toBeCloseTo(1, 3);
  });

  it('parses product rows and skips bad ones', () => {
    const rows = parseRows([['Pune', 73.8554, 18.5196, 3124458, 2, 'Maharashtra', 'IN'], ['bad'], 7, ['Delhi', 77.2, 28.6, 1, 0, '', 'IN']]);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.kind).toBe(0);
    expect(rows[0]).toMatchObject({ name: 'Pune', admin1: 'Maharashtra', kind: 2 });
    expect(() => parseRows({})).toThrow();
  });
});
