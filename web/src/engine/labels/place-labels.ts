import { Vector3, type PerspectiveCamera } from 'three';
import { EARTH_KM, lngLatToVec3 } from '../globe/geo';
import { tileAt } from '../tiles/tile-math';
import { boxSize, eligible, fade, labelSize, parseRows, placeLabels, priority, type Candidate, type Place } from './label-rules';

interface PlacesManifest { readonly kind: 'places'; readonly source: string; readonly license: string; readonly major: { readonly file: string }; readonly chunks: { readonly level: number; readonly tiles: readonly string[] } }
interface Entry { readonly place: Place; readonly id: string; readonly v: Vector3; readonly priority: number }
interface Shown { el: HTMLElement; opacity: number; target: number; readonly entry: Entry }

const MAX_LABELS = 70;
const CHUNKS_BELOW_KM = 1500;
const LAYOUT_EVERY = 3;

/** Our own place names (GeoNames product) as crisp HTML labels in Fraunces, with collision and fades. */
export class PlaceLabels {
  private manifest: PlacesManifest | null = null;
  private readonly entries: Entry[] = [];
  private readonly chunksLoaded = new Set<string>();
  private readonly shown = new Map<string, Shown>();
  private readonly v = new Vector3();
  private frame = 0;
  private placedCount = 0;

  constructor(private readonly root: HTMLElement, private readonly base: string) {}

  async load(): Promise<void> {
    const res = await fetch(`${this.base}manifest.json`);
    if (!res.ok) throw new Error(`places manifest: HTTP ${res.status}`);
    const m = (await res.json()) as PlacesManifest;
    if (m.kind !== 'places' || !m.source || !m.license) throw new Error('places manifest must name its source and licence');
    this.manifest = m;
    await this.addFile(m.major.file);
  }

  get source(): string { return this.manifest ? `${this.manifest.source} · ${this.manifest.license}` : ''; }
  get count(): number { return this.placedCount; }

  private async addFile(file: string): Promise<void> {
    const res = await fetch(this.base + file);
    if (!res.ok) throw new Error(`places ${file}: HTTP ${res.status}`);
    parseRows(await res.json()).forEach((p) => {
      this.entries.push({ place: p, id: `${p.name}|${p.lng}|${p.lat}`, v: lngLatToVec3(p.lng, p.lat, 1), priority: priority(p) });
    });
  }

  /** load the chunk under the camera and its neighbours once close enough */
  private ensureChunks(lng: number, lat: number, altKm: number): void {
    const m = this.manifest;
    if (!m || altKm > CHUNKS_BELOW_KM) return;
    const t = tileAt(lng, lat, m.chunks.level);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const key = `${(t.x + dx + 2 ** (m.chunks.level + 1)) % 2 ** (m.chunks.level + 1)}_${t.y + dy}`;
      if (this.chunksLoaded.has(key) || !m.chunks.tiles.includes(key)) continue;
      this.chunksLoaded.add(key);
      this.addFile(`${key}.json`).catch((err: unknown) => console.warn(`places chunk ${key}: ${(err as Error).message}`));
    }
  }

  update(camera: PerspectiveCamera, width: number, height: number, dt: number, at: { lng: number; lat: number; altKm: number }): void {
    this.ensureChunks(at.lng, at.lat, at.altKm);
    const eye = camera.position;
    if (this.frame++ % LAYOUT_EVERY === 0) this.layout(camera, eye, width, height, at.altKm);
    for (const [id, s] of this.shown) {
      s.opacity = fade(s.opacity, s.target, dt);
      if (s.target === 0 && s.opacity < 0.02) { s.el.remove(); this.shown.delete(id); continue; }
      this.v.copy(s.entry.v);
      const facing = this.v.dot(eye) - 1;
      this.v.project(camera);
      const x = (this.v.x * 0.5 + 0.5) * width;
      const y = (-this.v.y * 0.5 + 0.5) * height;
      s.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      s.el.style.opacity = (facing > 0 ? s.opacity : 0).toFixed(3);
    }
  }

  private layout(camera: PerspectiveCamera, eye: Vector3, width: number, height: number, altKm: number): void {
    const cands: Candidate[] = [];
    const byId = new Map<string, Entry>();
    const margin = 0.0005 + Math.min(0.02, altKm / EARTH_KM * 0.02);
    for (const e of this.entries) {
      if (e.v.dot(eye) < 1 + margin || !eligible(e.place, altKm)) continue;
      this.v.copy(e.v).project(camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) continue;
      const size = labelSize(e.place, altKm);
      const box = boxSize(e.place.name, size);
      cands.push({ id: e.id, x: (this.v.x * 0.5 + 0.5) * width, y: (-this.v.y * 0.5 + 0.5) * height, w: box.w, h: box.h, priority: e.priority });
      byId.set(e.id, e);
    }
    const placed = placeLabels(cands, MAX_LABELS);
    this.placedCount = placed.size;
    for (const [id, s] of this.shown) s.target = placed.has(id) ? 1 : 0;
    for (const id of placed) {
      if (this.shown.has(id)) continue;
      const entry = byId.get(id)!;
      const el = document.createElement('div');
      el.className = `place-label place-${labelSize(entry.place, altKm)}${entry.place.kind === 0 ? ' place-capital' : ''}`;
      el.textContent = entry.place.name;
      el.title = [entry.place.name, entry.place.admin1, entry.place.country].filter(Boolean).join(', ');
      el.style.opacity = '0';
      this.root.appendChild(el);
      this.shown.set(id, { el, opacity: 0, target: 1, entry });
    }
  }

  dispose(): void { this.shown.forEach((s) => s.el.remove()); this.shown.clear(); }
}
