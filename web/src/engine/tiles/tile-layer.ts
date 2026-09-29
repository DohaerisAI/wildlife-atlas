import { Frustum, Group, LinearFilter, Matrix4, Mesh, NearestFilter, PerspectiveCamera, Sphere, Texture, Vector3, Vector4, type BufferGeometry } from 'three';
import { monthBlend, tileOf } from '../living-earth/pack';
import { LruCache } from './cache';
import { drawKey, samplePoints, selectTiles, type DrawItem } from './lod';
import { patchGeometry } from './patch';
import { bounds, tileKey, uvWithin, type TileId } from './tile-math';
import { exists, maxLevel, sourceFor, tileUrl, type Tileset } from './tileset';
import { sharedUniforms, tileMaterial } from './tile-shader';

export interface TileLayerOptions {
  /** loaded tiles kept on the GPU */
  readonly budget: number;
  /** refine while one tile pixel covers more screen pixels than this */
  readonly maxScreenError: number;
  /** parallel tile fetches */
  readonly concurrency: number;
}

export interface TileStats { readonly drawn: number; readonly cached: number; readonly loading: number; readonly deepest: number; readonly wanted: number; readonly failed: number }

interface LoadedTile { readonly land: Texture; readonly ndvi: Texture | null }

const DEFAULTS: TileLayerOptions = { budget: 320, maxScreenError: 1.25, concurrency: 8 };

async function bitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
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

function tileSphere(t: TileId): Sphere {
  const pts = samplePoints(t).map((p) => new Vector3(...p));
  return new Sphere().setFromPoints(pts);
}

/** Quadtree Living Earth tiles on the unit sphere: picks, loads, caches and draws them every frame. */
export class TileLayer {
  readonly group = new Group();
  readonly uniforms = sharedUniforms();
  private readonly opts: TileLayerOptions;
  private readonly tiles: LruCache<LoadedTile>;
  private readonly geometries = new LruCache<{ geometry: BufferGeometry; center: Vector3 }>(900, (g) => g.geometry.dispose());
  private readonly spheres = new LruCache<Sphere>(4000);
  private readonly meshes = new Map<string, Mesh>();
  private readonly inflight = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly frustum = new Frustum();
  private readonly m4 = new Matrix4();
  private readonly deepest: number;
  private disposed = false;

  constructor(private readonly sets: readonly Tileset[], opts: Partial<TileLayerOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.tiles = new LruCache<LoadedTile>(this.opts.budget, (t) => { t.land.dispose(); t.ndvi?.dispose(); });
    this.deepest = maxLevel(sets);
    this.group.renderOrder = 1;
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

  update(camera: PerspectiveCamera, heightPx: number): TileStats {
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const e = camera.position;
    const sel = selectTiles({ eye: [e.x, e.y, e.z], fovY: (camera.fov * Math.PI) / 180, heightPx }, {
      maxScreenError: this.opts.maxScreenError, maxLevel: this.deepest,
      exists: (t) => !this.failed.has(tileKey(t)) && exists(this.sets, t),
      ready: (t) => this.tiles.has(tileKey(t)),
      inFrustum: (t) => t.z < 2 || this.frustum.intersectsSphere(this.sphere(t)),
    });
    for (const w of sel.want) {
      if (this.inflight.size >= this.opts.concurrency) break;
      this.load(w.tile);
    }
    const keep = new Set<string>();
    const used = new Set<string>();
    const shapes = new Set<string>();
    for (const d of sel.draw) {
      const k = drawKey(d);
      used.add(k);
      shapes.add(tileKey(d.tile));
      keep.add(tileKey(d.source));
      if (!this.meshes.has(k)) this.addMesh(k, d);
    }
    for (const [k, mesh] of this.meshes) if (!used.has(k)) this.removeMesh(k, mesh);
    // wanted tiles' loaded ancestors are about to be needed again; touch sources so they stay newest
    keep.forEach((k) => this.tiles.get(k));
    this.tiles.evict(keep);
    this.geometries.evict(shapes);
    return { drawn: sel.draw.length, cached: this.tiles.size, loading: this.inflight.size, deepest: sel.deepest, wanted: sel.want.length, failed: this.failed.size };
  }

  private sphere(t: TileId): Sphere {
    const k = tileKey(t);
    let s = this.spheres.get(k);
    if (!s) { s = tileSphere(t); this.spheres.set(k, s); this.spheres.evict(new Set()); }
    return s;
  }

  private addMesh(k: string, d: DrawItem): void {
    const loaded = this.tiles.get(tileKey(d.source));
    if (!loaded) return;
    const gk = tileKey(d.tile);
    let g = this.geometries.get(gk);
    if (!g) { g = patchGeometry(d.tile); this.geometries.set(gk, g); }
    const uv = uvWithin(d.tile, d.source);
    const b = bounds(d.tile);
    const mat = tileMaterial(this.uniforms, loaded.land, loaded.ndvi, new Vector3(uv.scale, uv.u, uv.v), new Vector4(b.west, b.south, b.east, b.north));
    const mesh = new Mesh(g.geometry, mat);
    mesh.position.copy(g.center);
    mesh.renderOrder = 1;
    mesh.frustumCulled = false; // the LOD walk already culled it
    this.meshes.set(k, mesh);
    this.group.add(mesh);
  }

  private removeMesh(k: string, mesh: Mesh): void {
    this.group.remove(mesh);
    (mesh.material as { dispose(): void }).dispose();
    this.meshes.delete(k);
  }

  private load(t: TileId): void {
    const k = tileKey(t);
    if (this.inflight.has(k) || this.tiles.has(k)) return;
    const set = sourceFor(this.sets, t);
    if (!set) return;
    this.inflight.add(k);
    const ndviUrl = set.manifest.ndvi ? tileUrl(set, 'ndvi', t) : null;
    Promise.all([bitmap(tileUrl(set, 'land', t)), ndviUrl ? bitmap(ndviUrl).catch(() => null) : Promise.resolve(null)])
      .then(([land, ndvi]) => {
        if (this.disposed) return;
        this.tiles.set(k, { land: dataTexture(land, false), ndvi: ndvi ? dataTexture(ndvi, true) : null });
      })
      .catch((err: unknown) => {
        this.failed.add(k);
        console.warn(`tile ${k} failed: ${(err as Error).message}`);
      })
      .finally(() => this.inflight.delete(k));
  }

  dispose(): void {
    this.disposed = true;
    this.meshes.forEach((m, k) => this.removeMesh(k, m));
    this.tiles.clear();
    this.geometries.clear();
  }
}
