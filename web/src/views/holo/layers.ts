import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, InstancedMesh,
  LineBasicMaterial, LineSegments, MeshBasicMaterial, Object3D, Points, PointsMaterial, ShaderMaterial, Vector3,
} from 'three';
import { cellIntensity, sampleFlow } from '../../scene/flow';
import type { SpeciesLayer } from '../../scene/view';
import { lngLatToVec3 } from './geo';
import { particleFragment, particleVertex, trailFragment, trailVertex } from './shaders';

export const PALETTE = {
  rim: new Color('#39d0ff'),
  core: new Color('#020a14'),
  outline: new Color('#5fd6ff'),
  focus: new Color('#9ff0ff'),
  pillar: new Color('#39d0ff'),
  pillarHot: new Color('#eafcff'),
  particle: new Color('#ffb36b'),
};

const PARTICLE_R = 1.006;
const TRAIL_LAG_MONTHS = 0.09;

export interface Outlines { world: number[][]; focus: number[][] }

export function outlineLayer(outlines: Outlines): Group {
  const group = new Group();
  const build = (rings: number[][], color: Color, opacity: number, r: number) => {
    const pts: number[] = [];
    const a = new Vector3();
    const b = new Vector3();
    for (const ring of rings) {
      for (let i = 0; i + 3 < ring.length; i += 2) {
        lngLatToVec3(ring[i]!, ring[i + 1]!, r, a);
        lngLatToVec3(ring[i + 2]!, ring[i + 3]!, r, b);
        pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    return new LineSegments(geo, new LineBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false }));
  };
  group.add(build(outlines.world, PALETTE.outline, 0.28, 1.001));
  group.add(build(outlines.focus, PALETTE.focus, 0.95, 1.0015));
  return group;
}

export function starField(count = 1800): Points {
  const pos = new Float32Array(count * 3);
  const v = new Vector3();
  for (let i = 0; i < count; i++) {
    v.randomDirection().multiplyScalar(40 + Math.random() * 20);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  return new Points(geo, new PointsMaterial({ color: '#8fb8d8', size: 0.08, transparent: true, opacity: 0.55, depthWrite: false }));
}

/** Holographic columns rising from each cell, height = species presence at the current time. */
export class PillarLayer {
  readonly mesh: InstancedMesh;
  private readonly ids: string[];
  private readonly bases: Vector3[];
  private readonly dummy = new Object3D();
  private readonly color = new Color();

  constructor(private readonly layer: SpeciesLayer) {
    this.ids = Object.keys(layer.range.cells);
    const geo = new BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    const mat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false });
    this.mesh = new InstancedMesh(geo, mat, Math.max(1, this.ids.length));
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.bases = this.ids.map((id) => {
      const [lat, lng] = id.split('_').map(Number) as [number, number];
      const half = layer.cellSize / 2;
      return lngLatToVec3(lng + half, lat + half, 1.0);
    });
  }

  update(t: number): void {
    const intensity = cellIntensity(this.layer.range, t, this.layer.peak);
    const width = (this.layer.cellSize * Math.PI) / 180 * 0.72;
    this.ids.forEach((id, i) => {
      const v = intensity.get(id) ?? 0;
      const base = this.bases[i]!;
      this.dummy.position.copy(base);
      this.dummy.lookAt(base.clone().multiplyScalar(2));
      this.dummy.scale.set(width, width, v > 0.001 ? 0.002 + v * 0.06 : 0.0001);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.copy(PALETTE.pillar).lerp(PALETTE.pillarHot, v * v * 0.5).multiplyScalar(0.04 + v * 0.32));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}

/** Glowing particle swarm plus short motion trails, both driven by the shared flow field. */
export class ParticleLayer {
  readonly points: Points;
  readonly trails: LineSegments;
  private readonly now: Float32Array;
  private readonly prev: Float32Array;
  private readonly v = new Vector3();

  constructor(private readonly layer: SpeciesLayer, pixelRatio: number) {
    const n = layer.flow.count;
    this.now = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);

    const pGeo = new BufferGeometry();
    pGeo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3).setUsage(DynamicDrawUsage));
    pGeo.setAttribute('alpha', new BufferAttribute(new Float32Array(n), 1).setUsage(DynamicDrawUsage));
    this.points = new Points(pGeo, new ShaderMaterial({
      vertexShader: particleVertex, fragmentShader: particleFragment,
      uniforms: { uColor: { value: PALETTE.particle }, uSize: { value: 4.2 }, uPixelRatio: { value: pixelRatio } },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    }));
    this.points.frustumCulled = false;

    const tGeo = new BufferGeometry();
    tGeo.setAttribute('position', new BufferAttribute(new Float32Array(n * 6), 3).setUsage(DynamicDrawUsage));
    tGeo.setAttribute('alpha', new BufferAttribute(new Float32Array(n * 2), 1).setUsage(DynamicDrawUsage));
    this.trails = new LineSegments(tGeo, new ShaderMaterial({
      vertexShader: trailVertex, fragmentShader: trailFragment,
      uniforms: { uColor: { value: PALETTE.particle } }, transparent: true, depthWrite: false, blending: AdditiveBlending,
    }));
    this.trails.frustumCulled = false;
  }

  update(t: number): void {
    const { flow } = this.layer;
    sampleFlow(flow, t, this.now);
    sampleFlow(flow, t - TRAIL_LAG_MONTHS, this.prev);
    const pPos = this.points.geometry.getAttribute('position') as BufferAttribute;
    const pAlpha = this.points.geometry.getAttribute('alpha') as BufferAttribute;
    const tPos = this.trails.geometry.getAttribute('position') as BufferAttribute;
    const tAlpha = this.trails.geometry.getAttribute('alpha') as BufferAttribute;
    for (let i = 0; i < flow.count; i++) {
      const a = this.now[i * 3 + 2]!;
      lngLatToVec3(this.now[i * 3]!, this.now[i * 3 + 1]!, PARTICLE_R, this.v);
      pPos.setXYZ(i, this.v.x, this.v.y, this.v.z);
      pAlpha.setX(i, a);
      tPos.setXYZ(i * 2 + 1, this.v.x, this.v.y, this.v.z);
      lngLatToVec3(this.prev[i * 3]!, this.prev[i * 3 + 1]!, PARTICLE_R, this.v);
      tPos.setXYZ(i * 2, this.v.x, this.v.y, this.v.z);
      tAlpha.setX(i * 2, 0);
      tAlpha.setX(i * 2 + 1, a);
    }
    pPos.needsUpdate = pAlpha.needsUpdate = tPos.needsUpdate = tAlpha.needsUpdate = true;
  }

  dispose(): void {
    for (const obj of [this.points, this.trails]) {
      obj.geometry.dispose();
      (obj.material as ShaderMaterial).dispose();
    }
  }
}
