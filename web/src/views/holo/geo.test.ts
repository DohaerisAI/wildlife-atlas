import { describe, expect, it } from 'vitest';
import { lngLatToVec3, vec3ToLngLat } from './geo';

describe('holo geo', () => {
  it.each([[77, 28], [-120, -33], [0, 0], [179, 60]])('round-trips %s,%s', (lng, lat) => {
    const back = vec3ToLngLat(lngLatToVec3(lng, lat, 1));
    expect(back.lng).toBeCloseTo(lng, 5);
    expect(back.lat).toBeCloseTo(lat, 5);
  });

  it('puts the north pole on +Y', () => {
    expect(lngLatToVec3(0, 90, 1).y).toBeCloseTo(1);
  });
});
