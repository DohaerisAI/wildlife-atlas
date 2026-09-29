import { describe, expect, it } from 'vitest';
import { decodeByte, monthBlend, PackError, tileOf, validateManifest, type PackManifest } from './pack';

const channel = (name: string, lo: number, hi: number) => ({ name, lo, hi, unit: 'u', source: 's' });
const MANIFEST: PackManifest = {
  version: 1,
  built: '2026-09-28T19:04+00:00',
  layout: { cols: 4, rows: 3, order: 'Jan..Dec row-major', projection: 'equirectangular, north up, 180W at left' },
  surface: { file: 'surface.png', month: [1024, 512], channels: [channel('water', 0, 100), channel('snow', 0, 100), channel('ndvi', -0.2, 0.9)] },
  climate: { file: 'climate.png', month: [360, 180], channels: [channel('wind_u', -15, 15), channel('wind_v', -15, 15), channel('temp', -40, 45)] },
  attribution: 'JRC; MODIS; ERA5',
};

describe('Living Earth pack manifest', () => {
  it('accepts the v1 manifest', () => {
    expect(validateManifest(MANIFEST)).toEqual(MANIFEST);
  });

  it('refuses a product without a manifest or with the wrong shape', () => {
    expect(() => validateManifest(null)).toThrow(PackError);
    expect(() => validateManifest({ ...MANIFEST, version: 3 })).toThrow(/version/);
    expect(() => validateManifest({ ...MANIFEST, layout: { ...MANIFEST.layout, cols: 3 } })).toThrow(/12 months/);
    const noWind = { ...MANIFEST, climate: { ...MANIFEST.climate, channels: MANIFEST.climate.channels.slice(2) } };
    expect(() => validateManifest(noWind)).toThrow(/wind_u/);
    const noSource = { ...MANIFEST, surface: { ...MANIFEST.surface, channels: [{ ...channel('water', 0, 100), source: '' }, ...MANIFEST.surface.channels.slice(1)] } };
    expect(() => validateManifest(noSource)).toThrow(/source/);
  });
});

describe('month blending', () => {
  it('anchors each month at mid-month', () => {
    expect(monthBlend(0.5)).toEqual({ m0: 0, m1: 1, w: 0 });
    expect(monthBlend(10.5)).toEqual({ m0: 10, m1: 11, w: 0 });
  });

  it('crossfades with ease-in-out between mid-months', () => {
    const b = monthBlend(1);
    expect(b.m0).toBe(0);
    expect(b.m1).toBe(1);
    expect(b.w).toBeCloseTo(0.5, 6);
    expect(monthBlend(0.6).w).toBeLessThan(0.1);
  });

  it('wraps December into January', () => {
    const early = monthBlend(0.2);
    expect([early.m0, early.m1]).toEqual([11, 0]);
    expect(monthBlend(11.9).m0).toBe(11);
    expect(monthBlend(11.9).m1).toBe(0);
  });
});

describe('atlas tiles and decoding', () => {
  it('lays months out row-major, Jan top-left', () => {
    expect(tileOf(0, MANIFEST.layout)).toEqual([0, 0]);
    expect(tileOf(5, MANIFEST.layout)).toEqual([1, 1]);
    expect(tileOf(11, MANIFEST.layout)).toEqual([3, 2]);
  });

  it('decodes bytes back to the channel range', () => {
    const wind = MANIFEST.climate.channels[0]!;
    expect(decodeByte(0, wind)).toBe(-15);
    expect(decodeByte(255, wind)).toBe(15);
    expect(decodeByte(127.5, wind)).toBeCloseTo(0, 6);
  });
});
