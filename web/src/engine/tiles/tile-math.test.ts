import { describe, expect, it } from 'vitest';
import { ancestor, bounds, children, cols, decodeIndex, hasTile, isValid, nearestPoint, pixelKm, rows, tile, tileAt, tileKey, uvWithin } from './tile-math';

describe('tile math (same scheme as pipeline tile_math.py)', () => {
  it('level 0 is the two hemispheres', () => {
    expect([cols(0), rows(0)]).toEqual([2, 1]);
    expect(bounds(tile(0, 0, 0))).toEqual({ west: -180, south: -90, east: 0, north: 90 });
    expect(bounds(tile(0, 1, 0)).west).toBe(0);
  });

  it('finds the tile under a place', () => {
    for (const [lng, lat, z] of [[73.86, 18.52, 8], [80.83, 24.58, 7], [34.83, -2.33, 8], [179.99, -89.99, 6]] as const) {
      const b = bounds(tileAt(lng, lat, z));
      expect(lng).toBeGreaterThanOrEqual(b.west); expect(lng).toBeLessThanOrEqual(b.east);
      expect(lat).toBeGreaterThanOrEqual(b.south); expect(lat).toBeLessThanOrEqual(b.north);
    }
    expect(tileKey(tileAt(73.86, 18.52, 5))).toBe('5/45/12'); // Pune
  });

  it('children, ancestors and where a tile sits inside an ancestor', () => {
    const kids = children(tile(5, 44, 12));
    expect(kids.map((k) => ancestor(k, 5))).toEqual(Array(4).fill(tile(5, 44, 12)));
    expect(ancestor(tile(8, 357, 99), 5)).toEqual(tile(5, 44, 12));
    expect(uvWithin(tile(7, 179, 50), tile(5, 44, 12))).toEqual({ scale: 0.25, u: 0.75, v: 0.5 });
    expect(uvWithin(tile(5, 44, 12), tile(5, 44, 12))).toEqual({ scale: 1, u: 0, v: 0 });
    expect(() => ancestor(tile(2, 0, 0), 3)).toThrow();
    expect(isValid(tile(2, 8, 0))).toBe(false);
  });

  it('pixel size reaches ~300 m at level 8', () => {
    expect(pixelKm(8)).toBeCloseTo(0.306, 2);
    expect(pixelKm(3)).toBeCloseTo(9.78, 1);
  });

  it('nearest point wraps the antimeridian', () => {
    const b = bounds(tile(3, 15, 3)); // 157.5E..180
    expect(nearestPoint(b, -179, 10)).toEqual({ lng: 180, lat: 10 });
    expect(nearestPoint(b, 170, 50)).toEqual({ lng: 170, lat: 22.5 });
  });

  it('reads the pipeline availability index', () => {
    // written by python: tile_math.encode_index(5, {(0, 0), (5, 3), (63, 31)})
    const b64 = 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgA==';
    const back = decodeIndex(b64);
    expect(hasTile(back, tile(5, 5, 3))).toBe(true);
    expect(hasTile(back, tile(5, 63, 31))).toBe(true);
    expect(hasTile(back, tile(5, 0, 0))).toBe(true);
    expect(hasTile(back, tile(5, 6, 3))).toBe(false);
  });
});
