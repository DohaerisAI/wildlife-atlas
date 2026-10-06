import { BufferAttribute, BufferGeometry, Color, DataTexture, Group, LinearFilter, LineBasicMaterial, LineLoop, Mesh, RedFormat, ShaderMaterial, SphereGeometry, UnsignedByteType } from 'three';
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

const RADIUS = 1.0002; // ~1.3 km above the tiles (drawn without a depth test, see the material)
const WASH_VERT = /* glsl */ `varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// the cell values spread by a soft blur at WASH_SCALE texels per cell (washGrid): the range reads as patches, not squares
const WASH_FRAG = /* glsl */ `
  uniform sampler2D uGrid; uniform vec3 uColor; uniform float uOpacity; varying vec3 vPos;
  void main() {
    vec3 p = normalize(vPos);
    vec2 uv = vec2(mod(degrees(atan(p.z, -p.x)), 360.0) / 360.0, (90.0 - degrees(asin(clamp(p.y, -1.0, 1.0)))) / 180.0);
    float a = texture2D(uGrid, uv).r;
    if (a <= 0.01) discard;
    gl_FragColor = vec4(uColor, a * uOpacity);
  }`;

export const WASH_SCALE = 4; // texels per cell side
const BLUR_SIGMA = 0.45 * WASH_SCALE; // in texels: a cell's value fades out over about one cell

/** Row-major (north first) wash bytes for a month at WASH_SCALE texels per cell, blurred so neighbouring cells merge
 *  into soft patches; 0 where the species is absent and far from any cell that has it. */
export function washGrid(values: ReadonlyMap<string, number>, size: number): { data: Uint8Array; cols: number; rows: number } {
  const cols = Math.round(360 / size) * WASH_SCALE, rows = Math.round(180 / size) * WASH_SCALE;
  const f = new Float32Array(cols * rows);
  for (const [id, v] of values) {
    const b = cellBounds(id, size);
    if (!b) continue;
    const c0 = Math.floor((b.west + 180) / size) * WASH_SCALE, r0 = Math.floor((90 - b.north) / size) * WASH_SCALE;
    if (c0 < 0 || c0 >= cols || r0 < 0 || r0 >= rows) continue;
    for (let r = 0; r < WASH_SCALE; r++) f.fill(Math.min(1, v), (r0 + r) * cols + c0, (r0 + r) * cols + c0 + WASH_SCALE);
  }
  const blurred = values.size ? blur(f, cols, rows, BLUR_SIGMA) : f;
  const data = new Uint8Array(cols * rows);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(Math.min(1, blurred[i]!) * 255);
  return { data, cols, rows };
}

/** Separable gaussian blur; columns wrap around the antimeridian, rows clamp at the poles. */
function blur(src: Float32Array, cols: number, rows: number, sigma: number): Float32Array {
  const rad = Math.ceil(sigma * 2.5);
  const k = Array.from({ length: 2 * rad + 1 }, (_, i) => Math.exp(-((i - rad) ** 2) / (2 * sigma * sigma)));
  const sum = k.reduce((a, b) => a + b, 0);
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let a = 0;
    for (let i = -rad; i <= rad; i++) a += src[y * cols + ((x + i + cols) % cols)]! * k[i + rad]!;
    tmp[y * cols + x] = a / sum;
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let a = 0;
    for (let i = -rad; i <= rad; i++) a += tmp[Math.min(rows - 1, Math.max(0, y + i)) * cols + x]! * k[i + rad]!;
    out[y * cols + x] = a / sum;
  }
  return out;
}

/**
 * The followed species' range as a soft wash of its grid cells, and the selected cell's square outline. Values come
 * from the species bundle per month; nothing moves that is not in the data.
 */
export class CellLayer {
  readonly group = new Group();
  private readonly grid: DataTexture;
  private readonly wash: Mesh;
  private readonly washMat: ShaderMaterial;
  private outline: LineLoop | null = null;
  private readonly lineMat = new LineBasicMaterial({ color: new Color('#e8edf1'), transparent: true, opacity: 0.9, depthWrite: false });
  private cells: Readonly<Record<string, { r: readonly number[] }>> | null = null;
  private month0 = -1;

  constructor(private readonly size: number) {
    this.group.renderOrder = 3;
    const { data, cols, rows } = washGrid(new Map(), size);
    this.grid = new DataTexture(data, cols, rows, RedFormat, UnsignedByteType);
    this.grid.unpackAlignment = 1;
    this.grid.magFilter = LinearFilter; this.grid.minFilter = LinearFilter;
    this.grid.needsUpdate = true;
    this.washMat = new ShaderMaterial({
      // no depth test: a shell this close to the ground sags below the tiles between its vertices (~1.2 km at 2.25
      // degree facets), which punched round holes in the wash; only front faces draw, so the far side stays hidden
      vertexShader: WASH_VERT, fragmentShader: WASH_FRAG, transparent: true, depthWrite: false, depthTest: false,
      uniforms: { uGrid: { value: this.grid }, uColor: { value: new Color('#ffb26b') }, uOpacity: { value: 0 } },
    });
    this.wash = new Mesh(new SphereGeometry(RADIUS, 160, 112), this.washMat);
    this.wash.renderOrder = 3;
    this.wash.visible = false;
    this.group.add(this.wash);
  }

  /** cells of the species (null clears), in its follow colour */
  setRange(cells: Readonly<Record<string, { r: readonly number[] }>> | null, color = '#ffb26b'): void {
    this.cells = cells && Object.keys(cells).length ? cells : null;
    this.washMat.uniforms.uColor!.value = new Color(color);
    this.month0 = -1;
    if (!this.cells) { this.fill(new Map()); this.wash.visible = false; }
  }

  setMonth(month0: number): void {
    if (!this.cells || month0 === this.month0) return;
    this.month0 = month0;
    this.fill(washValues(this.cells, month0));
  }

  private fill(values: ReadonlyMap<string, number>): void {
    (this.grid.image.data as Uint8Array).set(washGrid(values, this.size).data);
    this.grid.needsUpdate = true;
  }

  setWashOpacity(o: number): void { this.washMat.uniforms.uOpacity!.value = o; this.wash.visible = o > 0.01 && this.cells !== null; }

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
    this.setSelected(null);
    this.wash.geometry.dispose(); this.washMat.dispose(); this.grid.dispose(); this.lineMat.dispose();
  }
}
