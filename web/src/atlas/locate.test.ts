import { describe, expect, it } from 'vitest';
import { altitudeForZoom, LOCATE_MESSAGES, zoomForAltitude } from './locate';

describe('locate and hand-over', () => {
  it('maps globe altitude and map zoom both ways', () => {
    for (const z of [4.3, 6, 9, 12]) expect(zoomForAltitude(altitudeForZoom(z))).toBeCloseTo(z, 6);
    expect(zoomForAltitude(1400)).toBeGreaterThan(5);
  });

  it('explains every geolocation failure in plain words', () => {
    expect(Object.keys(LOCATE_MESSAGES)).toEqual(['1', '2', '3']);
    Object.values(LOCATE_MESSAGES).forEach((m) => expect(m).toMatch(/search for your town/));
  });
});
