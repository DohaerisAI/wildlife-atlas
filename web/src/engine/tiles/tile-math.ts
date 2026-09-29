/**
 * Geographic (EPSG:4326) tile quadtree, the same scheme as pipeline/atlas_pipeline/tile_math.py.
 * Level z has 2^(z+1) columns and 2^z rows of square tiles, 180/2^z degrees on a side, 256 px each.
 * x counts east from 180W, y counts south from 90N.
 */
export interface TileId { readonly z: number; readonly x: number; readonly y: number }
export interface Bounds { readonly west: number; readonly south: number; readonly east: number; readonly north: number }

export const TILE_PX = 256;
const KM_PER_DEG = 111.32;

export const cols = (z: number): number => 2 ** (z + 1);
export const rows = (z: number): number => 2 ** z;
export const span = (z: number): number => 180 / 2 ** z;
export const tileKey = (t: TileId): string => `${t.z}/${t.x}/${t.y}`;
export const tile = (z: number, x: number, y: number): TileId => ({ z, x, y });
export const ROOTS: readonly TileId[] = [tile(0, 0, 0), tile(0, 1, 0)];

export function isValid(t: TileId): boolean {
  return Number.isInteger(t.z) && t.z >= 0 && t.x >= 0 && t.x < cols(t.z) && t.y >= 0 && t.y < rows(t.z);
}

export function bounds(t: TileId): Bounds {
  const s = span(t.z);
  const west = -180 + t.x * s;
  const north = 90 - t.y * s;
  return { west, south: north - s, east: west + s, north };
}

export function tileAt(lng: number, lat: number, z: number): TileId {
  const s = span(z);
  return tile(z, Math.min(cols(z) - 1, Math.max(0, Math.floor((lng + 180) / s))), Math.min(rows(z) - 1, Math.max(0, Math.floor((90 - lat) / s))));
}

export function children(t: TileId): TileId[] {
  const z = t.z + 1;
  return [tile(z, 2 * t.x, 2 * t.y), tile(z, 2 * t.x + 1, 2 * t.y), tile(z, 2 * t.x, 2 * t.y + 1), tile(z, 2 * t.x + 1, 2 * t.y + 1)];
}

export function ancestor(t: TileId, level: number): TileId {
  if (level < 0 || level > t.z) throw new RangeError(`level ${level} is not above ${tileKey(t)}`);
  const k = t.z - level;
  return tile(level, t.x >> k, t.y >> k);
}

/** Where `t` sits inside its ancestor `a`, as a UV scale and offset (u east, v south, 0..1). */
export function uvWithin(t: TileId, a: TileId): { readonly scale: number; readonly u: number; readonly v: number } {
  const k = t.z - a.z;
  if (k < 0) throw new RangeError('uvWithin needs an ancestor');
  const n = 2 ** k;
  return { scale: 1 / n, u: (t.x - a.x * n) / n, v: (t.y - a.y * n) / n };
}

/** Ground size of one pixel of level z, in km (the same at every latitude north-south). */
export const pixelKm = (z: number): number => (span(z) / TILE_PX) * KM_PER_DEG;

/** The point of the tile closest to (lng, lat), in degrees: clamp, taking the short way round in longitude. */
export function nearestPoint(b: Bounds, lng: number, lat: number): { lng: number; lat: number } {
  const mid = (b.west + b.east) / 2;
  let l = lng;
  while (l - mid > 180) l -= 360;
  while (mid - l > 180) l += 360;
  return { lng: Math.min(b.east, Math.max(b.west, l)), lat: Math.min(b.north, Math.max(b.south, lat)) };
}

/** Level-z availability bitset (bit i = y * cols + x, LSB first) from its base64 text. */
export function decodeIndex(encoded: string): Uint8Array {
  const bin = atob(encoded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function hasTile(bits: Uint8Array, t: TileId): boolean {
  const i = t.y * cols(t.z) + t.x;
  return ((bits[i >> 3] ?? 0) >> (i & 7) & 1) === 1;
}
