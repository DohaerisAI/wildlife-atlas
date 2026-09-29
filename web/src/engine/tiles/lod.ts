import { bounds, children, nearestPoint, ROOTS, span, TILE_PX, tileKey, type TileId } from './tile-math';

/** Pure level-of-detail selection on the unit sphere (+Y north, lng 0 on -Z... see globe/geo.ts). */
export type Vec3 = readonly [number, number, number];

export interface ViewState {
  /** camera position in globe space (earth radius = 1) */
  readonly eye: Vec3;
  /** vertical field of view, radians */
  readonly fovY: number;
  /** drawing buffer height, px */
  readonly heightPx: number;
}

export interface LodOptions {
  /** refine while a tile pixel covers more screen pixels than this */
  readonly maxScreenError: number;
  readonly maxLevel: number;
  /** the tile has data (some tileset holds it) */
  readonly exists: (t: TileId) => boolean;
  /** the tile's data is loaded on the GPU */
  readonly ready: (t: TileId) => boolean;
  /** tile bounding sphere intersects the view frustum */
  readonly inFrustum: (t: TileId) => boolean;
  /** finer data exists somewhere below the tile (default: a direct child exists) */
  readonly deeper?: (t: TileId) => boolean;
  /** hard cap on how many tiles are asked for per frame */
  readonly maxWants?: number;
}

/** A patch to draw: `tile`'s shape, textured with `source` (itself, or the nearest loaded ancestor). */
export interface DrawItem { readonly tile: TileId; readonly source: TileId }
export interface Want { readonly tile: TileId; readonly error: number }
export interface Selection { readonly draw: readonly DrawItem[]; readonly want: readonly Want[]; readonly deepest: number }

const DEG = Math.PI / 180;

export function toVec3(lng: number, lat: number, r = 1): Vec3 {
  const phi = (90 - lat) * DEG;
  const theta = (lng + 180) * DEG;
  return [-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}

export function toLngLat(v: Vec3): { lng: number; lat: number } {
  const r = Math.hypot(v[0], v[1], v[2]);
  const lat = 90 - Math.acos(v[1] / r) / DEG;
  let lng = Math.atan2(v[2], -v[0]) / DEG - 180;
  if (lng < -180) lng += 360;
  return { lng, lat };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Corners, edge midpoints and centre of a tile on the unit sphere. */
export function samplePoints(t: TileId): Vec3[] {
  const b = bounds(t);
  const lngs = [b.west, (b.west + b.east) / 2, b.east];
  const lats = [b.south, (b.south + b.north) / 2, b.north];
  return lats.flatMap((lat) => lngs.map((lng) => toVec3(lng, lat)));
}

/** Point of the tile nearest the camera (clamped lng/lat of the point under the camera). */
export function nearestOnTile(t: TileId, eye: Vec3): Vec3 {
  const { lng, lat } = toLngLat(eye);
  const p = nearestPoint(bounds(t), lng, lat);
  return toVec3(p.lng, p.lat);
}

/** Beyond the horizon: no point of the tile can be seen from the eye (big tiles are always kept). */
export function beyondHorizon(t: TileId, eye: Vec3): boolean {
  if (t.z < 2) return false;
  const pts = [...samplePoints(t), nearestOnTile(t, eye)];
  // p is visible from eye when p . eye >= 1 (on the unit sphere); a little slack for the patch between samples
  return pts.every((p) => dot(p, eye) < 1 - span(t.z) * DEG * 0.5);
}

/** How many screen pixels one tile pixel covers at the tile's nearest point. */
export function screenError(t: TileId, v: ViewState): number {
  const texel = (span(t.z) * DEG) / TILE_PX;
  const d = Math.max(1e-7, dist(v.eye, nearestOnTile(t, v.eye)));
  return (texel * v.heightPx) / (2 * d * Math.tan(v.fovY / 2));
}

/**
 * Walk the quadtree from the two roots. A tile splits while its pixels look bigger than `maxScreenError`
 * and finer data exists. Every visible leaf is drawn with its own data when loaded, else with its nearest
 * loaded ancestor's (no holes); unloaded tiles on the way are wanted, coarse first.
 */
export function selectTiles(v: ViewState, o: LodOptions): Selection {
  const draw: DrawItem[] = [];
  const want: Want[] = [];
  let deepest = 0;
  const visit = (t: TileId, inherited: TileId | null) => {
    if (beyondHorizon(t, v.eye) || !o.inFrustum(t)) return;
    const has = o.exists(t);
    const loaded = has && o.ready(t);
    const source = loaded ? t : inherited;
    const error = screenError(t, v);
    if (has && !loaded) want.push({ tile: t, error });
    const split = error > o.maxScreenError && t.z < o.maxLevel && (o.deeper ? o.deeper(t) : children(t).some(o.exists));
    if (split) {
      children(t).forEach((c) => visit(c, source));
      return;
    }
    if (source) { draw.push({ tile: t, source }); deepest = Math.max(deepest, source.z); }
  };
  ROOTS.forEach((r) => visit(r, null));
  // coarse first (so the view sharpens step by step), then the most blurred
  want.sort((a, b) => a.tile.z - b.tile.z || b.error - a.error);
  return { draw, want: want.slice(0, o.maxWants ?? 48), deepest };
}

export const drawKey = (d: DrawItem): string => `${tileKey(d.tile)}@${tileKey(d.source)}`;
