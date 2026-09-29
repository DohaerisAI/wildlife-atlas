import { LinearFilter, NearestFilter, Texture } from 'three';
import { tileKey, type TileId } from './tile-math';
import { sourceFor, tileUrl, type Tileset } from './tileset';

export interface LoadedTile { readonly land: Texture; readonly ndvi: Texture | null; readonly loadedAt: number }

interface InFlight { readonly controller: AbortController; lastWanted: number }

async function bitmap(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  // data, not a picture: no colour management, no premultiplying
  return createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

function dataTexture(img: ImageBitmap, linear: boolean): Texture {
  const t = new Texture(img);
  t.flipY = false;
  t.generateMipmaps = false;
  t.minFilter = linear ? LinearFilter : NearestFilter;
  t.magFilter = linear ? LinearFilter : NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** Fetches tiles with a concurrency cap; every request can be aborted when its tile leaves the view. */
export class TileLoader {
  private readonly flying = new Map<string, InFlight>();
  readonly failed = new Set<string>();
  aborted = 0;

  constructor(private readonly sets: readonly Tileset[], private readonly concurrency: number, private readonly onLoad: (key: string, tile: LoadedTile) => void) {}

  get inflight(): number { return this.flying.size; }
  get free(): boolean { return this.flying.size < this.concurrency; }
  has(key: string): boolean { return this.flying.has(key); }

  /** when each in-flight tile was last wanted (for staleRequests) */
  lastWanted(): Map<string, number> {
    return new Map([...this.flying].map(([k, f]) => [k, f.lastWanted]));
  }

  touch(key: string, now: number): void { const f = this.flying.get(key); if (f) f.lastWanted = now; }

  abort(key: string): void {
    const f = this.flying.get(key);
    if (!f) return;
    f.controller.abort();
    this.flying.delete(key);
    this.aborted++;
  }

  load(t: TileId, now: number): void {
    const k = tileKey(t);
    if (this.flying.has(k) || this.failed.has(k)) return;
    const set = sourceFor(this.sets, t);
    if (!set) return;
    const controller = new AbortController();
    this.flying.set(k, { controller, lastWanted: now });
    const ndviUrl = set.manifest.ndvi ? tileUrl(set, 'ndvi', t) : null;
    const { signal } = controller;
    Promise.all([bitmap(tileUrl(set, 'land', t), signal), ndviUrl ? bitmap(ndviUrl, signal).catch((e: unknown) => { if (signal.aborted) throw e; return null; }) : Promise.resolve(null)])
      .then(([land, ndvi]) => {
        if (signal.aborted) return;
        this.onLoad(k, { land: dataTexture(land, false), ndvi: ndvi ? dataTexture(ndvi, true) : null, loadedAt: performance.now() });
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        this.failed.add(k);
        console.warn(`tile ${k} failed: ${(err as Error).message}`);
      })
      .finally(() => { if (this.flying.get(k)?.controller === controller) this.flying.delete(k); });
  }

  dispose(): void { [...this.flying.keys()].forEach((k) => this.abort(k)); }
}
