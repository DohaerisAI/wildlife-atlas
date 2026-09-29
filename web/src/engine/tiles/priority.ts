import { bounds, nearestPoint, tileKey, type TileId } from './tile-math';
import { toLngLat, toVec3, type Vec3, type Want } from './lod';

/**
 * Focus-first loading (like a street map resolving where you look): pure scoring and ordering of tile requests.
 * Lower score loads sooner. Terms: distance from the focus point (in view radii), level (coarse before fine at
 * the same place, so parents always arrive first), and how blurred the tile is on screen.
 */
export interface Focus {
  /** ground point the user is looking at: screen centre, or the zoom anchor under the cursor */
  readonly point: Vec3;
  /** angular radius of the visible ground, radians */
  readonly radius: number;
}

export type WantKind = 'view' | 'prefetch';
export interface QueuedWant extends Want { readonly kind: WantKind; readonly score: number }

export const WEIGHTS = { distance: 6, level: 0.5, blur: 0.5, prefetch: 3 } as const;

/** Visible ground radius (radians) from altitude and field of view, capped at the horizon. */
export function viewRadius(altKm: number, fovYRad: number, aspect = 1.6): number {
  const h = altKm / 6371;
  const halfDiag = Math.tan(fovYRad / 2) * Math.hypot(1, aspect);
  return Math.max(1e-5, Math.min(Math.acos(1 / (1 + h)), h * halfDiag));
}

export function focusAt(lng: number, lat: number, radius: number): Focus {
  return { point: toVec3(lng, lat), radius };
}

/** Angular distance from the focus to the nearest point of the tile, in view radii (0 = the tile holds the focus). */
export function focusDistance(t: TileId, f: Focus): number {
  const { lng, lat } = toLngLat(f.point);
  const p = nearestPoint(bounds(t), lng, lat);
  const q = toVec3(p.lng, p.lat);
  const c = Math.min(1, Math.max(-1, q[0] * f.point[0] + q[1] * f.point[1] + q[2] * f.point[2]));
  return Math.acos(c) / f.radius;
}

export function loadScore(w: Want, f: Focus, maxScreenError: number, kind: WantKind = 'view'): number {
  const blur = Math.min(4, Math.max(0, Math.log2(Math.max(1e-6, w.error) / maxScreenError)));
  return WEIGHTS.distance * focusDistance(w.tile, f) + WEIGHTS.level * w.tile.z - WEIGHTS.blur * blur + (kind === 'prefetch' ? WEIGHTS.prefetch : 0);
}

/** One queue: view wants and prefetches, deduplicated (a tile keeps its best score), best first. */
export function orderQueue(view: readonly Want[], prefetch: readonly Want[], f: Focus, maxScreenError: number): QueuedWant[] {
  const best = new Map<string, QueuedWant>();
  const add = (w: Want, kind: WantKind) => {
    const q: QueuedWant = { ...w, kind, score: loadScore(w, f, maxScreenError, kind) };
    const k = tileKey(w.tile);
    const old = best.get(k);
    if (!old || q.score < old.score) best.set(k, q);
  };
  view.forEach((w) => add(w, 'view'));
  prefetch.forEach((w) => add(w, 'prefetch'));
  return [...best.values()].sort((a, b) => a.score - b.score);
}

/** In-flight requests nobody has wanted for longer than `graceMs`: abort them so fresh tiles get the slots. */
export function staleRequests(inflight: ReadonlyMap<string, number>, wanted: ReadonlySet<string>, now: number, graceMs = 300): string[] {
  const out: string[] = [];
  inflight.forEach((lastWanted, key) => { if (!wanted.has(key) && now - lastWanted > graceMs) out.push(key); });
  return out;
}

/** Crossfade for a tile that has just arrived: 0 -> 1 over `ms`, eased. */
export function fadeIn(loadedAt: number, now: number, ms = 200): number {
  const k = Math.min(1, Math.max(0, (now - loadedAt) / ms));
  return k * k * (3 - 2 * k);
}
