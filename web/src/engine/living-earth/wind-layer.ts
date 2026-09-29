import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, LineSegments, PerspectiveCamera, ShaderMaterial, Vector3 } from 'three';
import { lngLatToVec3, vec3ToLngLat } from '../globe/geo';
import { LAYER_ORDER } from '../layers/order';
import { SHOWN, WIND, type StreakScale } from './motion';
import { advect, capPoint, sampleWind, type WindField } from './wind-field';

const RADIUS = 1.004;

/** How a streak field looks and moves. Wind is the default; ocean currents pass their own. */
export interface StreakStyle {
  readonly scale: StreakScale;
  readonly color: Color;
  readonly radius: number;
  readonly order: number;
  /** alpha multiplier in the shader */
  readonly gain: number;
  /** only seed streaks where this is true (currents: over the sea) */
  readonly where?: (lng: number, lat: number) => boolean;
}
const LIFE_S = [2.5, 5] as const;
/** Reduced motion: streaks hold still and only fade slowly in and out where they are. */
const REDUCED_LIFE_S = 9;

const VERT = /* glsl */ `attribute float alpha; varying float vA; void main() { vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = /* glsl */ `uniform vec3 uColor; uniform float uOpacity; uniform float uGain; varying float vA; void main() { gl_FragColor = vec4(uColor, vA * uOpacity * uGain); }`;

export const WIND_COLOR = new Color('#d9f2ff');
export const WIND_STYLE: StreakStyle = { scale: WIND, color: WIND_COLOR, radius: RADIUS, order: LAYER_ORDER.atmosphere, gain: 0.3 };
const SEED_TRIES = 6;

/**
 * ERA5 monthly-mean 10 m wind as short streaks. Speed and streak length follow the style guide's
 * motion scale; streaks are seeded across the hemisphere the camera sees, so density holds at any zoom.
 */
export class WindLayer {
  readonly lines: LineSegments;
  private readonly uniforms: { uColor: { value: Color }; uOpacity: { value: number }; uGain: { value: number } };
  private lng = new Float32Array(0);
  private lat = new Float32Array(0);
  private age = new Float32Array(0);
  private life = new Float32Array(0);
  private readonly v = new Vector3();
  private readonly camDir = new Vector3();
  private seed = 1;

  constructor(private readonly field: WindField, count: number, private readonly reduced: boolean, private readonly style: StreakStyle = WIND_STYLE) {
    this.uniforms = { uColor: { value: style.color }, uOpacity: { value: 0 }, uGain: { value: style.gain } };
    this.lines = new LineSegments(new BufferGeometry(), new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = style.order;
    this.resize(count);
  }

  /** Change the streak count (quality tier); streaks restart only if the count changes. */
  resize(count: number): void {
    if (count === this.lng.length) return;
    this.lng = new Float32Array(count);
    this.lat = new Float32Array(count);
    this.age = new Float32Array(count).fill(Number.POSITIVE_INFINITY);
    this.life = new Float32Array(count);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(count * 6), 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('alpha', new BufferAttribute(new Float32Array(count * 2), 1).setUsage(DynamicDrawUsage));
    this.lines.geometry.dispose();
    this.lines.geometry = geo;
  }

  setOpacity(v: number): void {
    this.uniforms.uOpacity.value = v;
    this.lines.visible = v > SHOWN;
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  update(t: number, dt: number, camera: PerspectiveCamera): void {
    if (!this.lines.visible) return;
    const dist = camera.position.length();
    const center = vec3ToLngLat(camera.position);
    const cap = Math.acos(Math.min(0.999, 1 / Math.max(dist, 1.001))) * 0.92;
    const cosCap = Math.cos(cap);
    const cam = this.camDir.copy(camera.position).normalize();
    const pos = this.lines.geometry.getAttribute('position') as BufferAttribute;
    const alpha = this.lines.geometry.getAttribute('alpha') as BufferAttribute;
    for (let i = 0; i < this.lng.length; i++) {
      // streaks left behind when the camera moves on are reseeded in view straight away
      const outOfView = lngLatToVec3(this.lng[i]!, this.lat[i]!, 1, this.v).dot(cam) < cosCap;
      if (this.age[i]! >= this.life[i]! || outOfView) {
        const first = this.age[i] === Number.POSITIVE_INFINITY;
        let [lng, lat] = capPoint(center.lng, center.lat, cap, this.rand(), this.rand());
        for (let k = 0; k < SEED_TRIES && this.style.where && !this.style.where(lng, lat); k++) [lng, lat] = capPoint(center.lng, center.lat, cap, this.rand(), this.rand());
        this.lng[i] = lng; this.lat[i] = lat;
        this.life[i] = this.reduced ? REDUCED_LIFE_S : LIFE_S[0] + this.rand() * (LIFE_S[1] - LIFE_S[0]);
        // stagger only the first fill; later streaks fade in from zero
        this.age[i] = first ? this.rand() * this.life[i]! : 0;
      }
      const [u, v] = sampleWind(this.field, this.lng[i]!, this.lat[i]!, t);
      if (!this.reduced) [this.lng[i], this.lat[i]] = advect(this.lng[i]!, this.lat[i]!, u, v, dt, this.style.scale);
      this.age[i] = this.age[i]! + dt;
      const speed = Math.hypot(u, v);
      const fade = Math.sin(Math.PI * Math.min(1, this.age[i]! / this.life[i]!));
      const allowed = !this.style.where || this.style.where(this.lng[i]!, this.lat[i]!);
      const a = allowed ? fade * Math.min(1, speed / this.style.scale.calmMs - 0.5) : 0;
      const [tailLng, tailLat] = advect(this.lng[i]!, this.lat[i]!, -u, -v, this.style.scale.streakS, this.style.scale);
      lngLatToVec3(this.lng[i]!, this.lat[i]!, this.style.radius, this.v);
      pos.setXYZ(i * 2 + 1, this.v.x, this.v.y, this.v.z);
      lngLatToVec3(tailLng, tailLat, this.style.radius, this.v);
      pos.setXYZ(i * 2, this.v.x, this.v.y, this.v.z);
      alpha.setX(i * 2, 0);
      alpha.setX(i * 2 + 1, Math.max(0, a));
    }
    pos.needsUpdate = alpha.needsUpdate = true;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as ShaderMaterial).dispose();
  }
}
