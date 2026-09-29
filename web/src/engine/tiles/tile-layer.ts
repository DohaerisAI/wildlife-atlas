import { Frustum, Group, Matrix4, Mesh, PerspectiveCamera, Sphere, Texture, Vector3, Vector4, type BufferGeometry, type ShaderMaterial } from 'three';
import { EARTH_KM } from '../globe/geo';
import { monthBlend, tileOf } from '../living-earth/pack';
import { LruCache } from './cache';
import { drawKey, samplePoints, selectTiles, toVec3, type DrawItem, type Want } from './lod';
import { patchGeometry } from './patch';
import { fadeIn, focusAt, focusDistance, orderQueue, staleRequests, viewRadius, type Focus } from './priority';
import { bounds, children, tileKey, uvWithin, type TileId } from './tile-math';
import { TileLoader, type LoadedTile } from './tile-loader';
import { exists, maxLevel, type Tileset } from './tileset';
import { sharedUniforms, tileMaterial } from './tile-shader';

export interface TileLayerOptions {
  /** loaded tiles kept on the GPU */
  readonly budget: number;
  /** refine while one tile pixel covers more screen pixels than this */
  readonly maxScreenError: number;
  /** parallel tile fetches */
  readonly concurrency: number;
  /** focus-first queue, prefetch, abort and crossfade; false = plain coarse-first loading (for comparison) */
  readonly focusFirst: boolean;
}

/** Where the user is looking and where the camera is heading (flight target, a pose ahead on the path). */
export interface TileFocus { readonly lng: number; readonly lat: number; readonly altKm: number; readonly ahead: readonly { lng: number; lat: number; altKm: number }[] }

export interface TileStats {
  readonly drawn: number; readonly cached: number; readonly loading: number; readonly deepest: number;
  readonly wanted: number; readonly queued: number; readonly prefetch: number; readonly aborted: number; readonly failed: number; readonly fading: number;
  /** level of the data drawn under the focus point */
  readonly focusLevel: number;
}

const DEFAULTS: TileLayerOptions = { budget: 360, maxScreenError: 1.25, concurrency: 6, focusFirst: true };
const FADE_MS = 200;
const PREFETCH_EVERY = 4;
const FOCUS_RING = 0.4;

const tileSphere = (t: TileId): Sphere => new Sphere().setFromPoints(samplePoints(t).map((p) => new Vector3(...p)));

/** Quadtree Living Earth tiles on the unit sphere: picks, queues (focus first), loads, caches and draws them. */
export class TileLayer {
  readonly group = new Group();
  readonly uniforms = sharedUniforms();
  private readonly opts: TileLayerOptions;
  private readonly tiles: LruCache<LoadedTile>;
  private readonly loader: TileLoader;
  private readonly geometries = new LruCache<{ geometry: BufferGeometry; center: Vector3 }>(900, (g) => g.geometry.dispose());
  private readonly spheres = new LruCache<Sphere>(4000);
  private readonly meshes = new Map<string, { mesh: Mesh; loadedAt: number; source: string }>();
  private readonly retiring = new Map<string, { mesh: Mesh; until: number; source: string }>();
  private readonly frustum = new Frustum();
  private readonly m4 = new Matrix4();
  private readonly deepest: number;
  private prefetch: Want[] = [];
  private frame = 0;

  constructor(private readonly sets: readonly Tileset[], opts: Partial<TileLayerOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.tiles = new LruCache<LoadedTile>(this.opts.budget, (t) => { t.land.dispose(); t.ndvi?.dispose(); });
    this.loader = new TileLoader(sets, this.opts.concurrency, (k, t) => this.tiles.set(k, t));
    this.deepest = maxLevel(sets);
  }

  setSurface(surface: Texture, monthPx: readonly [number, number], ndvi: { lo: number; hi: number }): void {
    this.uniforms.uSurface.value = surface;
    this.uniforms.uHalf.value.set(0.5 / monthPx[0], 0.5 / monthPx[1]);
    this.uniforms.uNdviLo.value = ndvi.lo;
    this.uniforms.uNdviHi.value = ndvi.hi;
  }

  /** t in months, mid-month anchored (the shared clock) */
  setMonth(t: number): void {
    const { m0, m1, w } = monthBlend(t);
    const u = this.uniforms;
    u.uT0.value.set(...tileOf(m0, { cols: 4 })); u.uT1.value.set(...tileOf(m1, { cols: 4 }));
    u.uM0.value = m0; u.uM1.value = m1; u.uW.value = w;
  }

  setAlpha(a: number): void { this.uniforms.uAlpha.value = a; this.group.visible = a > 0.01; }

  private readonly has = (t: TileId): boolean => !this.loader.failed.has(tileKey(t)) && exists(this.sets, t);
  private readonly ready = (t: TileId): boolean => this.tiles.has(tileKey(t));

  update(camera: PerspectiveCamera, heightPx: number, focus: TileFocus): TileStats {
    const now = performance.now();
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const e = camera.position;
    const fovY = (camera.fov * Math.PI) / 180;
    const sel = selectTiles({ eye: [e.x, e.y, e.z], fovY, heightPx }, {
      maxScreenError: this.opts.maxScreenError, maxLevel: this.deepest, exists: this.has, ready: this.ready, maxWants: 1000,
      inFrustum: (t) => t.z < 2 || this.frustum.intersectsSphere(this.sphere(t)),
    });
    const f = focusAt(focus.lng, focus.lat, viewRadius(focus.altKm, fovY, camera.aspect));
    if (this.opts.focusFirst && this.frame++ % PREFETCH_EVERY === 0) this.prefetch = this.prefetchWants(sel.draw, f, focus, fovY, heightPx);
    const queue = this.opts.focusFirst ? orderQueue(sel.want, this.prefetch, f, this.opts.maxScreenError) : sel.want.map((w) => ({ ...w, kind: 'view' as const, score: w.tile.z }));
    this.request(queue.map((q) => q.tile), now);
    const fading = this.draw(sel.draw, now);
    const under = sel.draw.find((d) => { const b = bounds(d.tile); return focus.lng >= b.west && focus.lng <= b.east && focus.lat >= b.south && focus.lat <= b.north; });
    return {
      focusLevel: under?.source.z ?? -1,
      drawn: sel.draw.length, cached: this.tiles.size, loading: this.loader.inflight, deepest: sel.deepest, wanted: sel.want.length,
      queued: queue.filter((q) => !this.loader.has(tileKey(q.tile))).length, prefetch: this.prefetch.length,
      aborted: this.loader.aborted, failed: this.loader.failed.size, fading,
    };
  }

  /** One level finer around the focus, and what the camera will want where it is flying. */
  private prefetchWants(draw: readonly DrawItem[], f: Focus, focus: TileFocus, fovY: number, heightPx: number): Want[] {
    const out: Want[] = [];
    for (const d of draw) {
      if (d.tile.z >= this.deepest || focusDistance(d.tile, f) > FOCUS_RING) continue;
      children(d.tile).forEach((c) => { if (this.has(c) && !this.ready(c)) out.push({ tile: c, error: 1 }); });
    }
    for (const p of focus.ahead) {
      const pf = focusAt(p.lng, p.lat, viewRadius(p.altKm, fovY));
      const ahead = selectTiles({ eye: toVec3(p.lng, p.lat, 1 + p.altKm / EARTH_KM), fovY, heightPx }, {
        maxScreenError: this.opts.maxScreenError, maxLevel: this.deepest, exists: this.has, ready: this.ready, maxWants: 1000,
        inFrustum: (t) => focusDistance(t, pf) < 1,
      });
      out.push(...orderQueue(ahead.want, [], pf, this.opts.maxScreenError).slice(0, 24));
    }
    return out;
  }

  /** Start the best requests, keep wanted ones alive, abort stale ones so fresh tiles get the slots. */
  private request(order: readonly TileId[], now: number): void {
    const wanted = new Set(order.map(tileKey));
    wanted.forEach((k) => this.loader.touch(k, now));
    if (this.opts.focusFirst) staleRequests(this.loader.lastWanted(), wanted, now).forEach((k) => this.loader.abort(k));
    for (const t of order) {
      if (!this.loader.free) break;
      if (!this.tiles.has(tileKey(t))) this.loader.load(t, now);
    }
  }

  /** Sync meshes with the draw list; new sharp tiles fade in over the patch they replace. Returns how many fade. */
  private draw(items: readonly DrawItem[], now: number): number {
    const keep = new Set<string>();
    const used = new Set<string>();
    const shapes = new Set<string>();
    let fading = 0;
    for (const d of items) {
      const k = drawKey(d);
      used.add(k); shapes.add(tileKey(d.tile)); keep.add(tileKey(d.source));
      const m = this.meshes.get(k) ?? this.addMesh(k, d);
      if (!m) continue;
      const a = this.opts.focusFirst ? fadeIn(m.loadedAt, now, FADE_MS) : 1;
      (m.mesh.material as ShaderMaterial).uniforms.uFade!.value = a;
      m.mesh.renderOrder = a < 1 ? 2 : 1;
      if (a < 1) fading++;
    }
    for (const [k, m] of this.meshes) {
      if (used.has(k)) continue;
      this.meshes.delete(k);
      // keep the coarser patch under a sharper one that is still fading in, so sharpening reads as a focus pull
      if (fading > 0) this.retiring.set(k, { mesh: m.mesh, until: now + FADE_MS, source: m.source });
      else this.drop(m.mesh);
    }
    for (const [k, r] of this.retiring) {
      if (now > r.until || fading === 0) { this.drop(r.mesh); this.retiring.delete(k); continue; }
      r.mesh.renderOrder = 0.5;
      keep.add(r.source);
    }
    keep.forEach((k) => this.tiles.get(k));
    this.tiles.evict(keep);
    this.geometries.evict(shapes);
    return fading;
  }

  private sphere(t: TileId): Sphere {
    const k = tileKey(t);
    let s = this.spheres.get(k);
    if (!s) { s = tileSphere(t); this.spheres.set(k, s); this.spheres.evict(new Set()); }
    return s;
  }

  private addMesh(k: string, d: DrawItem): { mesh: Mesh; loadedAt: number; source: string } | null {
    const src = tileKey(d.source);
    const loaded = this.tiles.get(src);
    if (!loaded) return null;
    const gk = tileKey(d.tile);
    let g = this.geometries.get(gk);
    if (!g) { g = patchGeometry(d.tile); this.geometries.set(gk, g); }
    const uv = uvWithin(d.tile, d.source);
    const b = bounds(d.tile);
    const mesh = new Mesh(g.geometry, tileMaterial(this.uniforms, loaded.land, loaded.ndvi, new Vector3(uv.scale, uv.u, uv.v), new Vector4(b.west, b.south, b.east, b.north)));
    mesh.position.copy(g.center);
    mesh.frustumCulled = false; // the LOD walk already culled it
    this.group.add(mesh);
    const entry = { mesh, loadedAt: loaded.loadedAt, source: src };
    this.meshes.set(k, entry);
    return entry;
  }

  private drop(mesh: Mesh): void {
    this.group.remove(mesh);
    (mesh.material as ShaderMaterial).dispose();
  }

  dispose(): void {
    this.loader.dispose();
    this.meshes.forEach((m) => this.drop(m.mesh));
    this.retiring.forEach((r) => this.drop(r.mesh));
    this.meshes.clear(); this.retiring.clear();
    this.tiles.clear();
    this.geometries.clear();
  }
}
