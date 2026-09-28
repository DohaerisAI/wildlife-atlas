import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, Line, Points, ShaderMaterial, Vector3 } from 'three';
import { lngLatToVec3 } from '../globe/geo';
import { LAYER_ORDER } from './order';
import type { GeoPath } from './path';

const SAMPLES = 240;
const RADIUS = 1.01;
const L_VERT = /* glsl */ `attribute float u; uniform float uProgress; varying float vA;
  void main() { float k = u / max(uProgress, 1e-4); vA = step(u, uProgress) * pow(clamp(k, 0.0, 1.0), 2.2); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const L_FRAG = /* glsl */ `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main() { gl_FragColor = vec4(uColor, vA * uOpacity); }`;
const H_VERT = /* glsl */ `uniform float uPixelRatio; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = 34.0 * uPixelRatio / -mv.z; gl_Position = projectionMatrix * mv; }`;
const H_FRAG = /* glsl */ `uniform vec3 uColor; uniform float uOpacity; void main() { float d = length(gl_PointCoord - 0.5); float g = exp(-d * d * 28.0); float core = smoothstep(0.12, 0.0, d);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), core), (g * 0.9 + core) * uOpacity); }`;

/** A tracked individual: a bright head that draws its route behind it as progress advances. */
export class TrackLayer {
  readonly group = new Group();
  private readonly uniforms: { uColor: { value: Color }; uOpacity: { value: number }; uProgress: { value: number }; uPixelRatio: { value: number } };
  private readonly head: Points;
  private progress = 0;

  constructor(private readonly path: GeoPath, color: string, pixelRatio: number) {
    this.uniforms = { uColor: { value: new Color(color) }, uOpacity: { value: 0 }, uProgress: { value: 0 }, uPixelRatio: { value: pixelRatio } };
    const pos = new Float32Array((SAMPLES + 1) * 3);
    const us = new Float32Array(SAMPLES + 1);
    const v = new Vector3();
    for (let i = 0; i <= SAMPLES; i++) {
      const u = i / SAMPLES; const [lng, lat] = path.at(u);
      lngLatToVec3(lng, lat, RADIUS, v); pos.set([v.x, v.y, v.z], i * 3); us[i] = u;
    }
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(pos, 3));
    lg.setAttribute('u', new BufferAttribute(us, 1));
    const line = new Line(lg, new ShaderMaterial({ vertexShader: L_VERT, fragmentShader: L_FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: AdditiveBlending }));
    const hg = new BufferGeometry();
    hg.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    this.head = new Points(hg, new ShaderMaterial({ vertexShader: H_VERT, fragmentShader: H_FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: AdditiveBlending }));
    for (const o of [line, this.head]) { o.frustumCulled = false; o.renderOrder = LAYER_ORDER.individuals; }
    this.group.add(line, this.head);
  }

  set(progress: number, opacity: number): void {
    this.progress = Math.max(0, Math.min(1, progress));
    this.uniforms.uProgress.value = this.progress;
    this.uniforms.uOpacity.value = opacity;
    this.group.visible = opacity > 0.005;
    const [lng, lat] = this.path.at(this.progress);
    const v = lngLatToVec3(lng, lat, RADIUS);
    (this.head.geometry.getAttribute('position') as BufferAttribute).setXYZ(0, v.x, v.y, v.z);
    this.head.geometry.getAttribute('position').needsUpdate = true;
  }

  headLngLat(): [number, number] { return this.path.at(this.progress); }

  dispose(): void {
    this.group.children.forEach((o) => { const m = o as Line | Points; m.geometry.dispose(); (m.material as ShaderMaterial).dispose(); });
  }
}
