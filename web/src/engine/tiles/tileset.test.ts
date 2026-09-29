import { describe, expect, it } from 'vitest';
import { bySpecificity, inSet, loadTileset, makeTileset, maxLevel, retryDelay, sourceFor, tileUrl, validateTileset, type TilesetManifest } from './tileset';
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
  });
});
