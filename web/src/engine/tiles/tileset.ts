import { children, cols, decodeIndex, hasTile, rows, type TileId } from './tile-math';

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
  readonly rgb?: { readonly path: string; readonly source: string; readonly license: string } | null;
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
  /** per level above the finest: tiles with some tile of this set somewhere below them */
  readonly reach: ReadonlyMap<number, Uint8Array>;
}

/** Mark every ancestor of each present tile, level by level (so the LOD walk can reach levels behind a gap). */
function reachOf(bits: ReadonlyMap<number, Uint8Array>, hi: number): Map<number, Uint8Array> {
  const reach = new Map<number, Uint8Array>();
  let below: Uint8Array | undefined;
  for (let z = hi; z >= 1; z--) {
    const own = bits.get(z);
    const src = own && below ? own.map((b, i) => b | below![i]!) : own ?? below;
    if (!src) break;
    const up = new Uint8Array(Math.ceil((cols(z - 1) * rows(z - 1)) / 8));
    const c = cols(z);
    for (let i = 0; i < src.length; i++) {
      const byte = src[i]!;
      if (byte === 0) continue;
      for (let bit = 0; bit < 8; bit++) {
        if (!(byte >> bit & 1)) continue;
        const k = i * 8 + bit; const x = k % c; const y = Math.floor(k / c);
        const pk = (y >> 1) * cols(z - 1) + (x >> 1);
        up[pk >> 3]! |= 1 << (pk & 7);
      }
    }
    reach.set(z - 1, up);
    below = up;
  }
  return reach;
}

export function makeTileset(base: string, manifest: TilesetManifest): Tileset {
  const bits = new Map<number, Uint8Array>();
  for (let z = manifest.levels[0]; z <= manifest.levels[1]; z++) bits.set(z, decodeIndex(manifest.index[String(z)]!));
  return { manifest, base, bits, reach: reachOf(bits, manifest.levels[1]) };
}

/** Some tileset has data below `t` (not necessarily its direct children). */
export function hasDeeper(sets: readonly Tileset[], t: TileId): boolean {
  return sets.some((s) => { const r = s.reach.get(t.z); return r !== undefined && hasTile(r, t); });
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

export function tileUrl(ts: Tileset, kind: 'land' | 'ndvi' | 'rgb', t: TileId): string {
  const path = kind === 'land' ? ts.manifest.land.path : kind === 'ndvi' ? ts.manifest.ndvi?.path : ts.manifest.rgb?.path;
  if (!path) throw new TilesetError(`${ts.manifest.name} has no ${kind} layer`);
  return ts.base + path.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
}

/** Load one tileset's manifest; throws when it is missing, half written or invalid. */
export async function loadTileset(base: string, fetcher: typeof fetch = fetch): Promise<Tileset> {
  const res = await fetcher(`${base}manifest.json`, { cache: 'no-store' });
  if (!res.ok) throw new TilesetError(`HTTP ${res.status}`);
  return makeTileset(base, validateTileset(await res.json()));
}

/** Finest ranges first, so sourceFor prefers detail over the world pack. */
export const bySpecificity = (sets: readonly Tileset[]): Tileset[] => [...sets].sort((a, b) => b.manifest.levels[0] - a.manifest.levels[0]);

/** Seconds to wait before retry `attempt` (0-based): 1, 2, 4 ... capped at 30. */
export const retryDelay = (attempt: number): number => Math.min(30, 2 ** Math.max(0, attempt));

/** What changes when tiles are added: the build time and the per-level counts. */
export const manifestStamp = (m: TilesetManifest & { built?: string; counts?: unknown }): string => `${m.built ?? ''}|${JSON.stringify(m.counts ?? m.index)}`;

/**
 * Keep a tileset current: retry with backoff until it loads (a manifest can be missing while tiles are rebuilt),
 * then poll every `refreshS` seconds and hand over a new version when shards have been absorbed into it, so the
 * view sharpens where data lands. `status` reports 'loading', 'ok' or 'unavailable, retrying' for the HUD.
 */
export function watchTileset(base: string, status: (s: string) => void, onLoad: (ts: Tileset) => void, fetcher: typeof fetch = fetch, refreshS = 30): () => void {
  let stopped = false;
  let timer = 0;
  let stamp = '';
  const later = (fn: () => void, s: number) => { timer = window.setTimeout(fn, s * 1000); };
  const attempt = (n: number) => {
    if (!stamp) status(n === 0 ? 'loading' : 'unavailable, retrying');
    loadTileset(base, fetcher).then((ts) => {
      if (stopped) return;
      const next = manifestStamp(ts.manifest);
      if (next !== stamp) { stamp = next; status('ok'); onLoad(ts); }
      later(() => attempt(0), refreshS);
    }).catch((err: unknown) => {
      if (stopped) return;
      if (stamp) { later(() => attempt(0), refreshS); return; } // keep the loaded version through a rebuild
      status('unavailable, retrying');
      if (n === 0) console.warn(`tileset ${base} unavailable (${(err as Error).message}); retrying`);
      later(() => attempt(n + 1), retryDelay(n));
    });
  };
  attempt(0);
  return () => { stopped = true; window.clearTimeout(timer); };
}
