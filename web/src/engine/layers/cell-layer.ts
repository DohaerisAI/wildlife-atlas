import { BufferAttribute, BufferGeometry, Color, Group, LineBasicMaterial, LineLoop, Mesh, ShaderMaterial } from 'three';
import { lngLatToVec3 } from '../globe/geo';

/** Grid cells are named "lat_lng" of their south-west corner (pipeline grid.py). */
export function cellBounds(id: string, size: number): { west: number; south: number; east: number; north: number } | null {
  const [lat, lng] = id.split('_').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { west: lng!, south: lat!, east: lng! + size, north: lat! + size };
}

/** Per-cell wash value for a month: share of the species' peak monthly rate, 0 where it is absent. */
export function washValues(cells: Readonly<Record<string, { r: readonly number[] }>>, month0: number): Map<string, number> {
  let peak = 0;
  for (const c of Object.values(cells)) for (const v of c.r) peak = Math.max(peak, v);
  const out = new Map<string, number>();
  if (peak <= 0) return out;
  for (const [id, c] of Object.entries(cells)) {
    const v = c.r[month0] ?? 0;
    if (v > 0) out.set(id, 0.2 + 0.8 * (v / peak));
  }
  return out;
}

const RADIUS = 1.0002; // ~1.3 km above the tiles, below the camera's 3 km floor
const WASH_VERT = /* glsl */ `attribute float aValue; varying float vValue; void main() { vValue = aValue; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const WASH_FRAG = /* glsl */ `uniform vec3 uColor; uniform float uOpacity; varying float vValue; void main() { if (vValue <= 0.0) discard; gl_FragColor = vec4(uColor, vValue * uOpacity); }`;

/**
 * The followed species' range as a wash of its grid cells (what the street map drew), and the selected cell's
 * square outline. Values come from the species bundle per month; nothing moves that is not in the data.
 */
export class CellLayer {
  readonly group = new Group();
  private wash: Mesh | null = null;
  private ids: string[] = [];
  private readonly washMat = new ShaderMaterial({
    vertexShader: WASH_VERT, fragmentShader: WASH_FRAG, transparent: true, depthWrite: false,
    uniforms: { uColor: { value: new Color('#ffb26b') }, uOpacity: { value: 0 } },
  });
  private outline: LineLoop | null = null;
  private readonly lineMat = new LineBasicMaterial({ color: new Color('#e8edf1'), transparent: true, opacity: 0.9, depthWrite: false });

  constructor(private readonly size: number) { this.group.renderOrder = 3; }

  /** cells of the species (null clears), in its follow colour */
  setRange(cells: Readonly<Record<string, { r: readonly number[] }>> | null, color = '#ffb26b'): void {
    if (this.wash) { this.group.remove(this.wash); this.wash.geometry.dispose(); this.wash = null; }
    this.ids = cells ? Object.keys(cells) : [];
    this.washMat.uniforms.uColor!.value = new Color(color);
    if (!cells || this.ids.length === 0) return;
    const pos = new Float32Array(this.ids.length * 12);
    const idx: number[] = [];
    this.ids.forEach((id, i) => {
      const b = cellBounds(id, this.size);
      if (!b) return;
      [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]].forEach(([lng, lat], k) => {
        const v = lngLatToVec3(lng!, lat!, RADIUS);
        pos.set([v.x, v.y, v.z], i * 12 + k * 3);
      });
      const o = i * 4;
      idx.push(o, o + 3, o + 1, o + 1, o + 3, o + 2);
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aValue', new BufferAttribute(new Float32Array(this.ids.length * 4), 1));
    g.setIndex(idx);
    this.wash = new Mesh(g, this.washMat);
    this.wash.renderOrder = 3;
    this.group.add(this.wash);
    this.cells = cells;
  }

  private cells: Readonly<Record<string, { r: readonly number[] }>> | null = null;
  private month0 = -1;

  setMonth(month0: number): void {
    if (!this.wash || !this.cells || month0 === this.month0) return;
    this.month0 = month0;
    const values = washValues(this.cells, month0);
    const a = this.wash.geometry.getAttribute('aValue') as BufferAttribute;
    this.ids.forEach((id, i) => { const v = values.get(id) ?? 0; for (let k = 0; k < 4; k++) a.setX(i * 4 + k, v); });
    a.needsUpdate = true;
  }

  setWashOpacity(o: number): void { this.washMat.uniforms.uOpacity!.value = o; if (this.wash) this.wash.visible = o > 0.01; }

  /** outline the selected cell (null clears) */
  setSelected(id: string | null): void {
    if (this.outline) { this.group.remove(this.outline); this.outline.geometry.dispose(); this.outline = null; }
    const b = id ? cellBounds(id, this.size) : null;
    if (!b) return;
    const pts: number[] = [];
    const steps = 16;
    const edge = (lng0: number, lat0: number, lng1: number, lat1: number) => {
      for (let s = 0; s < steps; s++) { const k = s / steps; const v = lngLatToVec3(lng0 + (lng1 - lng0) * k, lat0 + (lat1 - lat0) * k, RADIUS + 0.00005); pts.push(v.x, v.y, v.z); }
    };
    edge(b.west, b.north, b.east, b.north); edge(b.east, b.north, b.east, b.south); edge(b.east, b.south, b.west, b.south); edge(b.west, b.south, b.west, b.north);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    this.outline = new LineLoop(g, this.lineMat);
    this.outline.renderOrder = 4;
    this.group.add(this.outline);
  }

  dispose(): void {
    this.setRange(null); this.setSelected(null);
    this.washMat.dispose(); this.lineMat.dispose();
  }
}
