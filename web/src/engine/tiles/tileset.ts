import { children, decodeIndex, hasTile, type TileId } from './tile-math';

/** A Living Earth tileset manifest (pipeline tile_product.manifest). No manifest, no product (architecture rule). */
export interface TileChannel { readonly name: string; readonly lo: number; readonly hi: number; readonly source: string }
export interface TilesetManifest {
  readonly version: 1;
  readonly kind: 'living-earth-tiles';
  readonly name: string;
  readonly tileSize: number;
  readonly levels: readonly [number, number];
  readonly bounds: readonly [number, number, number, number];
  readonly land: { readonly path: string; readonly channels: readonly TileChannel[] };
  readonly ndvi: { readonly path: string; readonly layout: { readonly cols: number; readonly rows: number; readonly frame: readonly [number, number] }; readonly channel: TileChannel } | null;
  readonly index: Readonly<Record<string, string>>;
  readonly attribution: string;
}

export class TilesetError extends Error {}

const LAND_CHANNELS = ['class', 'tree', 'hillshade'] as const;

export function validateTileset(raw: unknown): TilesetManifest {
  const m = raw as Partial<TilesetManifest> | null;
  if (!m || m.kind !== 'living-earth-tiles' || m.version !== 1) throw new TilesetError('not a Living Earth tiles v1 manifest');
  if (m.tileSize !== 256) throw new TilesetError('tiles must be 256 px');
  const lv = m.levels;
  if (!Array.isArray(lv) || lv.length !== 2 || !(lv[0] >= 0 && lv[1] >= lv[0])) throw new TilesetError('levels must be [min, max]');
  if (!m.land || typeof m.land.path !== 'string') throw new TilesetError('land layer missing');
  LAND_CHANNELS.forEach((name, i) => {
    const c = m.land!.channels?.[i];
    if (!c || c.name !== name || !c.source) throw new TilesetError(`land channel ${i} must be ${name} with a source`);
  });
  if (m.ndvi && (!m.ndvi.channel?.source || m.ndvi.layout?.cols !== 4 || m.ndvi.layout?.rows !== 3)) throw new TilesetError('ndvi layer must be a 4 x 3 atlas with a source');
  for (let z = lv[0]; z <= lv[1]; z++) if (typeof m.index?.[String(z)] !== 'string') throw new TilesetError(`index for level ${z} missing`);
  if (!m.attribution) throw new TilesetError('attribution missing');
  return m as TilesetManifest;
}

export interface Tileset {
  readonly manifest: TilesetManifest;
  readonly base: string;
  readonly bits: ReadonlyMap<number, Uint8Array>;
}

export function makeTileset(base: string, manifest: TilesetManifest): Tileset {
  const bits = new Map<number, Uint8Array>();
  for (let z = manifest.levels[0]; z <= manifest.levels[1]; z++) bits.set(z, decodeIndex(manifest.index[String(z)]!));
  return { manifest, base, bits };
}

export function inSet(ts: Tileset, t: TileId): boolean {
  const b = ts.bits.get(t.z);
  return b !== undefined && hasTile(b, t);
}

/** The tileset that holds `t`, finest range first. */
export function sourceFor(sets: readonly Tileset[], t: TileId): Tileset | null {
  return sets.find((s) => inSet(s, t)) ?? null;
}

export const exists = (sets: readonly Tileset[], t: TileId): boolean => sourceFor(sets, t) !== null;

/** Worth splitting: some child exists in some tileset. */
export const hasChildren = (sets: readonly Tileset[], t: TileId): boolean => children(t).some((c) => exists(sets, c));

export function maxLevel(sets: readonly Tileset[]): number {
  return Math.max(0, ...sets.map((s) => s.manifest.levels[1]));
}

export function tileUrl(ts: Tileset, kind: 'land' | 'ndvi', t: TileId): string {
  const path = kind === 'land' ? ts.manifest.land.path : ts.manifest.ndvi?.path;
  if (!path) throw new TilesetError(`${ts.manifest.name} has no ${kind} layer`);
  return ts.base + path.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
}

/** Load tileset manifests; sets that are missing or invalid are skipped with a warning (the rest still draw). */
export async function loadTilesets(bases: readonly string[], fetcher: typeof fetch = fetch): Promise<Tileset[]> {
  const loaded = await Promise.all(bases.map(async (base) => {
    try {
      const res = await fetcher(`${base}manifest.json`);
      if (!res.ok) throw new TilesetError(`HTTP ${res.status}`);
      return makeTileset(base, validateTileset(await res.json()));
    } catch (err) {
      console.warn(`tileset ${base} unavailable: ${(err as Error).message}`);
      return null;
    }
  }));
  // finest ranges first so sourceFor prefers detail over the world pack
  return loaded.filter((s): s is Tileset => s !== null).sort((a, b) => b.manifest.levels[0] - a.manifest.levels[0]);
}
