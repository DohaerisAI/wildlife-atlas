import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, LineSegments, Points, ShaderMaterial, Vector3 } from 'three';
import { sampleFlow, type FlowField } from '../../scene/flow';
import { lngLatToVec3 } from '../globe/geo';
import { LAYER_ORDER } from './order';

const RADIUS = 1.006;
const TRAIL_LAG_MONTHS = 0.09;

const P_VERT = /* glsl */ `
  attribute float alpha; uniform float uSize; uniform float uPixelRatio; varying float vA;
  void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = alpha; gl_PointSize = clamp(uSize * 1.4 * uPixelRatio / -mv.z, 1.4 * uPixelRatio, 6.0 * uPixelRatio); gl_Position = projectionMatrix * mv; }`;
const P_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uOpacity; varying float vA;
  void main() { float d = length(gl_PointCoord - 0.5); float core = smoothstep(0.5, 0.0, d); float a = core * core * vA * uOpacity * 0.65;
    if (a < 0.01) discard;
    // white-hot centre: animals read as light, never as another patch of ground
    vec3 col = mix(uColor * (0.7 + 0.6 * core), vec3(1.0), pow(core, 4.0) * 0.22);
    gl_FragColor = vec4(col, a); }`;
const T_VERT = /* glsl */ `attribute float alpha; varying float vA; void main() { vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const T_FRAG = /* glsl */ `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main() { gl_FragColor = vec4(uColor, vA * uOpacity * 0.32); }`;

/** One species as glowing particles with short motion trails, driven by the shared flow field. */
export class FlowLayer {
  readonly group = new Group();
  private readonly now: Float32Array;
  private readonly prev: Float32Array;
  private readonly v = new Vector3();
  private readonly uniforms: { uColor: { value: Color }; uOpacity: { value: number }; uSize: { value: number }; uPixelRatio: { value: number } };
  private readonly points: Points;
  private readonly trails: LineSegments;

  constructor(private readonly flow: FlowField, color: string, pixelRatio: number) {
    const n = flow.count;
    this.now = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.uniforms = { uColor: { value: new Color(color) }, uOpacity: { value: 1 }, uSize: { value: 4.2 }, uPixelRatio: { value: pixelRatio } };
    const pg = new BufferGeometry();
    pg.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3).setUsage(DynamicDrawUsage));
    pg.setAttribute('alpha', new BufferAttribute(new Float32Array(n), 1).setUsage(DynamicDrawUsage));
    this.points = new Points(pg, new ShaderMaterial({ vertexShader: P_VERT, fragmentShader: P_FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: AdditiveBlending }));
    const tg = new BufferGeometry();
    tg.setAttribute('position', new BufferAttribute(new Float32Array(n * 6), 3).setUsage(DynamicDrawUsage));
    tg.setAttribute('alpha', new BufferAttribute(new Float32Array(n * 2), 1).setUsage(DynamicDrawUsage));
    this.trails = new LineSegments(tg, new ShaderMaterial({ vertexShader: T_VERT, fragmentShader: T_FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: AdditiveBlending }));
    for (const o of [this.points, this.trails]) { o.frustumCulled = false; o.renderOrder = LAYER_ORDER.animals; }
    this.group.add(this.trails, this.points);
  }

  setOpacity(v: number): void {
    this.uniforms.uOpacity.value = v;
    this.group.visible = v > 0.005;
  }

  update(t: number): void {
    if (!this.group.visible) return;
    sampleFlow(this.flow, t, this.now);
    sampleFlow(this.flow, t - TRAIL_LAG_MONTHS, this.prev);
    const pPos = this.points.geometry.getAttribute('position') as BufferAttribute;
    const pA = this.points.geometry.getAttribute('alpha') as BufferAttribute;
    const tPos = this.trails.geometry.getAttribute('position') as BufferAttribute;
    const tA = this.trails.geometry.getAttribute('alpha') as BufferAttribute;
    for (let i = 0; i < this.flow.count; i++) {
      const a = this.now[i * 3 + 2]!;
      lngLatToVec3(this.now[i * 3]!, this.now[i * 3 + 1]!, RADIUS, this.v);
      pPos.setXYZ(i, this.v.x, this.v.y, this.v.z); pA.setX(i, a);
      tPos.setXYZ(i * 2 + 1, this.v.x, this.v.y, this.v.z);
      lngLatToVec3(this.prev[i * 3]!, this.prev[i * 3 + 1]!, RADIUS, this.v);
      tPos.setXYZ(i * 2, this.v.x, this.v.y, this.v.z);
      tA.setX(i * 2, 0); tA.setX(i * 2 + 1, a);
    }
    pPos.needsUpdate = pA.needsUpdate = tPos.needsUpdate = tA.needsUpdate = true;
  }

  dispose(): void {
    for (const o of [this.points, this.trails]) { o.geometry.dispose(); (o.material as ShaderMaterial).dispose(); }
  }
}
