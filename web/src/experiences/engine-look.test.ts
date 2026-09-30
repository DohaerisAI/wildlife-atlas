import { describe, expect, it } from 'vitest';
import { closeness, zoomLook } from './engine-look';

describe('engine look by altitude', () => {
  it('is the dot hologram from space and a solid surface close in', () => {
    const space = zoomLook(20000);
    expect(space.dotAlpha).toBe(1);
    expect(space.gridAlpha).toBe(1);
    expect(space.tileAlpha).toBeCloseTo(0.3);
    const town = zoomLook(10);
    expect(town.dotAlpha).toBe(0);
    expect(town.gridAlpha).toBe(0); // no 15 degree grid band across a close-in coast
    expect(town.tileAlpha).toBe(1);
  });

  it('fades globe-scale layers out before they blur over the tiles', () => {
    expect(zoomLook(20000).channels.wind).toBeCloseTo(0.6);
    expect(zoomLook(300).channels.wind).toBe(0);
    expect(zoomLook(50).channels.water).toBe(0);
    expect(zoomLook(2500).channels.water).toBe(0); // no JRC glow on a coast seen from 2500 km
    expect(zoomLook(2500).gridAlpha).toBe(0);
    expect(zoomLook(50).channels.depth).toBe(0);
  });

  it('adds close-zoom texture and real colour only near the ground', () => {
    expect(zoomLook(500).detail).toBe(0);
    expect(zoomLook(5).detail).toBe(1);
    expect(zoomLook(1000).real).toBe(0);
    expect(zoomLook(10).real).toBe(1);
  });

  it('changes smoothly and monotonically', () => {
    const alts = [20000, 8000, 3000, 1000, 300, 50];
    const t = alts.map((a) => zoomLook(a).tileAlpha);
    t.slice(1).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(t[i]!));
    expect(closeness(1000, 100, 10000)).toBeCloseTo(0.5, 5);
  });
});
