import { describe, expect, it } from 'vitest';
import { altitudeKmToZoom, zoomToAltitudeKm } from './view';

describe('zoom/altitude conversion', () => {
  it('round-trips', () => expect(altitudeKmToZoom(zoomToAltitudeKm(4.6))).toBeCloseTo(4.6));
  it('regional zoom is a few thousand km up', () => {
    expect(zoomToAltitudeKm(4.6)).toBeGreaterThan(1500);
    expect(zoomToAltitudeKm(4.6)).toBeLessThan(3500);
  });
});

import { effectivePitch } from './view';

describe('effectivePitch', () => {
  it('looks straight down from high up', () => expect(effectivePitch(10000, -50)).toBe(-90));
  it('uses the requested tilt near the ground', () => expect(effectivePitch(500, -50)).toBe(-50));
  it('blends in between', () => {
    const p = effectivePitch(2400, -50);
    expect(p).toBeLessThan(-50);
    expect(p).toBeGreaterThan(-90);
  });
});
