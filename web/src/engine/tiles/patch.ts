import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { bounds, span, type TileId } from './tile-math';
import { toVec3 } from './lod';

/** Grid segments per tile edge: big tiles need more to follow the curve. */
export const segmentsFor = (z: number): number => (z <= 1 ? 48 : z <= 3 ? 24 : 16);

export interface PatchArrays {
  /** positions relative to `center` (keeps float precision close to the ground) */
  readonly positions: Float32Array;
  /** u east, v south, 0..1 over the tile */
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly center: readonly [number, number, number];
}

/**
 * A sphere patch for a tile: (n+1)^2 grid vertices on the unit sphere plus a skirt that hangs just below each
 * edge, so a coarser neighbour never shows a crack. Pure arrays; `patchGeometry` wraps them for three.js.
 */
export function patchArrays(t: TileId, n = segmentsFor(t.z)): PatchArrays {
  const b = bounds(t);
  const skirt = Math.max(2e-5, span(t.z) * (Math.PI / 180) * 0.01);
  const c = toVec3((b.west + b.east) / 2, (b.south + b.north) / 2);
  const pos: number[] = [];
  const uv: number[] = [];
  const put = (i: number, j: number, r: number) => {
    const u = i / n; const v = j / n;
    const p = toVec3(b.west + u * (b.east - b.west), b.north - v * (b.north - b.south), r);
    pos.push(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
    uv.push(u, v);
  };
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) put(i, j, 1);
  const idx: number[] = [];
  const at = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) idx.push(at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1));
  }
  // skirt: walk the border once, dropping a copy of each edge vertex below the surface
  const border: [number, number][] = [];
  for (let i = 0; i < n; i++) border.push([i, 0]);
  for (let j = 0; j < n; j++) border.push([n, j]);
  for (let i = n; i > 0; i--) border.push([i, n]);
  for (let j = n; j > 0; j--) border.push([0, j]);
  const base = pos.length / 3;
  border.forEach(([i, j]) => put(i, j, 1 - skirt));
  border.forEach(([i, j], k) => {
    const [i2, j2] = border[(k + 1) % border.length]!;
    const a = at(i, j); const b2 = at(i2, j2); const s1 = base + k; const s2 = base + ((k + 1) % border.length);
    idx.push(a, s1, b2, b2, s1, s2);
  });
  return { positions: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint32Array(idx), center: c };
}

export function patchGeometry(t: TileId): { geometry: BufferGeometry; center: Vector3 } {
  const a = patchArrays(t);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(a.positions, 3));
  g.setAttribute('uv', new BufferAttribute(a.uvs, 2));
  g.setIndex(new BufferAttribute(a.indices, 1));
  g.computeBoundingSphere();
  return { geometry: g, center: new Vector3(...a.center) };
}
