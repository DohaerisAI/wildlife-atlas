import { describe, expect, it } from 'vitest';
import { bySpecificity, manifestStamp, ndviSource, inSet, loadTileset, makeTileset, maxLevel, retryDelay, sourceFor, tileUrl, validateTileset, type TilesetManifest } from './tileset';
import { tile, tileAt } from './tile-math';

const ch = (name: string) => ({ name, lo: 0, hi: 255, source: 'test source' });
const manifest = (name: string, levels: [number, number], index: Record<string, string>): TilesetManifest => ({
  version: 1, kind: 'living-earth-tiles', name, tileSize: 256, levels, bounds: [-180, -90, 180, 90],
  land: { path: 'land/{z}/{x}/{y}.png', channels: [ch('class'), ch('tree'), ch('hillshade')] }, ndvi: null, index, attribution: 'test',
});
// level 0: both hemispheres present (bits 0 and 1)
const world = manifest('world', [0, 0], { 0: btoa(String.fromCharCode(3)) });

describe('tilesets', () => {
  it('refuses a manifest without sources or index', () => {
    expect(validateTileset(world).name).toBe('world');
    expect(() => validateTileset({ ...world, land: { ...world.land, channels: [ch('class')] } })).toThrow(/tree/);
    expect(() => validateTileset({ ...world, index: {} })).toThrow(/index/);
    expect(() => validateTileset(null)).toThrow();
  });

  it('prefers the finest tileset that holds a tile', () => {
    const w = makeTileset('/w/', world);
    const d = makeTileset('/d/', manifest('detail', [1, 1], { 1: btoa(String.fromCharCode(1)) }));
    const sets = bySpecificity([w, d]);
    expect(sets[0]!.manifest.name).toBe('detail');
    expect(sourceFor(sets, tile(1, 0, 0))?.manifest.name).toBe('detail');
    expect(sourceFor(sets, tile(1, 1, 0))).toBeNull();
    expect(inSet(w, tile(0, 1, 0))).toBe(true);
    expect(maxLevel(sets)).toBe(1);
    expect(tileUrl(w, 'land', tileAt(10, 10, 0))).toBe('/w/land/0/1/0.png');
  });

  it('loads over fetch, and backs off 1, 2, 4 ... 30 s between retries', async () => {
    const ok = (async () => new Response(JSON.stringify(world))) as unknown as typeof fetch;
    expect((await loadTileset('/w/', ok)).manifest.name).toBe('world');
    const missing = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(loadTileset('/x/', missing)).rejects.toThrow(/404/);
    expect([0, 1, 2, 3, 10].map(retryDelay)).toEqual([1, 2, 4, 8, 30]);
    // a new shard changes the stamp, so a running page swaps the tileset in
    expect(manifestStamp({ ...world, built: 'a' } as never)).not.toBe(manifestStamp({ ...world, built: 'b' } as never));
  });

  describe('ndvi below its finest level', () => {
    const ndvi = (levels?: [number, number]) => ({ path: 'ndvi/{z}/{x}/{y}.png', layout: { cols: 4, rows: 3, frame: [64, 64] as [number, number] }, channel: ch('ndvi'), ...(levels ? { levels } : {}) });
    const town = (levels?: [number, number]) => makeTileset('/s/', { ...manifest('sites', [9, 11], { 9: '', 10: '', 11: '' }), ndvi: ndvi(levels) });

    it('uses the tile itself at levels with NDVI tiles', () => {
      const s = ndviSource(town([9, 9]), tile(9, 700, 100));
      expect(s).toEqual({ tile: tile(9, 700, 100), scale: 1, u: 0, v: 0 });
      expect(tileUrl(town([9, 9]), 'ndvi', s!.tile)).toBe('/s/ndvi/9/700/100.png');
    });

    it('maps a level-10 tile to its quarter of the level-9 ancestor', () => {
      expect(ndviSource(town([9, 9]), tile(10, 1401, 200))).toEqual({ tile: tile(9, 700, 100), scale: 0.5, u: 0.5, v: 0 });
      expect(ndviSource(town([9, 9]), tile(10, 1400, 201))).toEqual({ tile: tile(9, 700, 100), scale: 0.5, u: 0, v: 0.5 });
    });

    it('maps a level-11 tile to its sixteenth of the level-9 ancestor', () => {
      // x 2803 = 700*4 + 3, y 402 = 100*4 + 2: east column, third row
      expect(ndviSource(town([9, 9]), tile(11, 2803, 402))).toEqual({ tile: tile(9, 700, 100), scale: 0.25, u: 0.75, v: 0.5 });
    });

    it('falls back to the tileset levels when the manifest names none, and to nothing without NDVI', () => {
      expect(ndviSource(town(), tile(11, 2803, 402))?.tile).toEqual(tile(11, 2803, 402));
      expect(ndviSource(makeTileset('/w/', world), tile(0, 0, 0))).toBeNull();
    });

    it('refuses NDVI levels outside the tileset', () => {
      const m = { ...manifest('sites', [9, 11], { 9: '', 10: '', 11: '' }), ndvi: ndvi([9, 12]) };
      expect(() => validateTileset(m)).toThrow(/ndvi levels/);
      expect(validateTileset({ ...m, ndvi: ndvi([9, 9]) }).ndvi?.levels).toEqual([9, 9]);
    });
  });
});
