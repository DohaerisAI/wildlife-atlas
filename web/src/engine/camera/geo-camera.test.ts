import { describe, expect, it } from 'vitest';
import { clipPlanes, degreesPerPixel, flightPose, MAX_ALT_KM, MIN_ALT_KM, panBy, wrapLng, zoomBy } from './geo-camera';

const FOV = (34 * Math.PI) / 180;

describe('space-to-town camera', () => {
  it('zooms by the same ratio at every altitude and stays in range', () => {
    expect(zoomBy(10000, 100) / 10000).toBeCloseTo(zoomBy(1000, 100) / 1000, 6);
    expect(zoomBy(500, -100000)).toBe(MIN_ALT_KM);
    expect(MIN_ALT_KM).toBe(200); // the finest data worldwide is ~300-500 m per pixel
    expect(zoomBy(20000, 100000)).toBe(MAX_ALT_KM);
  });

  it('pans less per pixel close in', () => {
    expect(degreesPerPixel(10, FOV, 900)).toBeLessThan(degreesPerPixel(1000, FOV, 900));
    expect(degreesPerPixel(20000, FOV, 900) * 900).toBeLessThanOrEqual(120.0001);
    const p = panBy({ lng: 179.99, lat: 84.9, altKm: 5000 }, -100, 500, FOV, 900);
    expect(p.lat).toBeLessThanOrEqual(85);
    expect(p.lng).toBeGreaterThanOrEqual(-180); expect(p.lng).toBeLessThan(180);
  });

  it('keeps near and far tight around the visible ground', () => {
    const town = clipPlanes(5);
    expect(town.near).toBeLessThan(5 / 6371);
    expect(town.far).toBeGreaterThan(Math.sqrt((1 + 5 / 6371) ** 2 - 1));
    expect(town.far / town.near).toBeLessThan(3000);
    const space = clipPlanes(20000);
    expect(space.far).toBeGreaterThan(1 + 20000 / 6371); // the far side of the atmosphere shell
    expect(space.near).toBeLessThan(20000 / 6371 - 0.1);
  });

  it('flies in one motion, ending exactly on the target and rising for long hops', () => {
    const from = { lng: 78, lat: 20, altKm: 20000 };
    const to = { lng: 73.86, lat: 18.52, altKm: 250 };
    const end = flightPose(from, to, 1);
    expect(end.lng).toBeCloseTo(73.86, 6); expect(end.altKm).toBeCloseTo(250, 3);
    const alts = [0.25, 0.5, 0.75].map((k) => flightPose(from, to, k).altKm);
    expect(alts[0]! > alts[1]! && alts[1]! > alts[2]!).toBe(true); // falling all the way
    const hop = flightPose({ lng: 73.86, lat: 18.52, altKm: 250 }, { lng: 34.8, lat: -2.3, altKm: 250 }, 0.5);
    expect(hop.altKm).toBeGreaterThan(1000);
    expect(wrapLng(190)).toBe(-170);
  });
});

describe('zoom toward the cursor', () => {
  it('moves the centre toward the anchor when zooming in and away when zooming out', async () => {
    const { zoomToward } = await import('./geo-camera');
    const p = { lng: 73, lat: 18, altKm: 100 };
    const inward = zoomToward(p, { lng: 74, lat: 19 }, 0.5);
    expect(inward.lng).toBeCloseTo(73.5); expect(inward.lat).toBeCloseTo(18.5);
    const out = zoomToward(p, { lng: 74, lat: 19 }, 2);
    expect(out.lng).toBeCloseTo(72);
    expect(zoomToward({ lng: 179.5, lat: 0, altKm: 10 }, { lng: -179.5, lat: 0 }, 0).lng).toBeCloseTo(-179.5);
  });
});
