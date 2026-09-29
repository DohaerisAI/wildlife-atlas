import { describe, expect, it } from 'vitest';
import { beyondHorizon, screenError, selectTiles, toLngLat, toVec3, type LodOptions, type ViewState } from './lod';
import { bounds, tile, tileAt, tileKey, type TileId } from './tile-math';

const EARTH_KM = 6371;
const view = (lng: number, lat: number, altKm: number): ViewState => ({ eye: toVec3(lng, lat, 1 + altKm / EARTH_KM), fovY: (34 * Math.PI) / 180, heightPx: 900 });
const all = (over: Partial<LodOptions> = {}): LodOptions => ({ maxScreenError: 1.5, maxLevel: 8, exists: () => true, ready: () => true, inFrustum: () => true, ...over });
const covers = (t: TileId, lng: number, lat: number) => { const b = bounds(t); return lng >= b.west && lng <= b.east && lat >= b.south && lat <= b.north; };

describe('LOD selection', () => {
  it('round-trips lng/lat through the sphere convention', () => {
    const { lng, lat } = toLngLat(toVec3(73.86, 18.52));
    expect(lng).toBeCloseTo(73.86, 6); expect(lat).toBeCloseTo(18.52, 6);
  });

  it('stays coarse from far away and goes deep close in', () => {
    const far = selectTiles(view(78, 20, 20000), all());
    expect(far.deepest).toBeLessThanOrEqual(3);
    const near = selectTiles(view(73.86, 18.52, 50), all());
    expect(near.deepest).toBe(8);
    const under = near.draw.find((d) => covers(d.tile, 73.86, 18.52));
    expect(under?.tile.z).toBe(8);
  });

  it('tiles further away are coarser', () => {
    const s = selectTiles(view(73.86, 18.52, 300), all());
    const at = (lng: number, lat: number) => s.draw.find((d) => covers(d.tile, lng, lat))!.tile.z;
    expect(at(73.86, 18.52)).toBeGreaterThan(at(83, 25));
  });

  it('never leaves a hole: unloaded tiles draw with the nearest loaded ancestor and are wanted coarse first', () => {
    const loaded = new Set(['0/0/0', '0/1/0']);
    const s = selectTiles(view(73.86, 18.52, 50), all({ ready: (t) => loaded.has(tileKey(t)) }));
    expect(s.draw.length).toBeGreaterThan(0);
    expect(s.draw.every((d) => d.source.z === 0)).toBe(true);
    expect(s.want[0]!.tile.z).toBe(1);
    expect(s.deepest).toBe(0);
  });

  it('missing children use the parent texture, and nothing splits without finer data', () => {
    const pune8 = tileAt(73.86, 18.52, 8);
    const exists = (t: TileId) => t.z <= 5 || (t.z <= 8 && covers(t, 73.86, 18.52));
    const s = selectTiles(view(73.86, 18.52, 50), all({ exists }));
    expect(s.draw.some((d) => tileKey(d.tile) === tileKey(pune8) && tileKey(d.source) === tileKey(pune8))).toBe(true);
    const sibling = s.draw.find((d) => d.tile.z === 8 && tileKey(d.tile) !== tileKey(pune8));
    expect(sibling?.source.z).toBeLessThan(8);
  });

  it('culls the far side and frustum rejects', () => {
    expect(beyondHorizon(tileAt(-100, -20, 5), view(78, 20, 500).eye)).toBe(true);
    expect(beyondHorizon(tileAt(78, 20, 5), view(78, 20, 500).eye)).toBe(false);
    const none = selectTiles(view(78, 20, 500), all({ inFrustum: () => false }));
    expect(none.draw).toEqual([]);
  });

  it('screen error shrinks with distance and halves per level', () => {
    const t = tile(6, 90, 25);
    expect(screenError(t, view(73.86, 18.52, 100))).toBeGreaterThan(screenError(t, view(73.86, 18.52, 1000)));
    const c = tile(7, 180, 50);
    const v = view(73.9, 18.5, 20000);
    expect(screenError(c, v) / screenError(tile(6, 90, 25), v)).toBeCloseTo(0.5, 1);
  });
});
