import {
  AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Color, Group, Mesh, Points, ShaderMaterial, SphereGeometry,
} from 'three';
import { lngLatToVec3 } from './geo';
import { fibonacciLngLat, sampleMask, type LandMask } from './mask';

const BODY_VERT = /* glsl */ `
  varying vec3 vNormal; varying vec3 vView; varying vec3 vPos;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPos = position;
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-(viewMatrix * world).xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const BODY_FRAG = /* glsl */ `
  uniform vec3 uCore; uniform vec3 uRim; uniform float uTime;
  varying vec3 vNormal; varying vec3 vView; varying vec3 vPos;
  void main() {
    float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);
    vec3 p = normalize(vPos);
    float lat = degrees(asin(p.y));
    float lng = degrees(atan(p.z, -p.x));
    float gLat = 1.0 - smoothstep(0.0, 0.08, abs(fract(lat / 15.0 + 0.5) - 0.5) * 15.0);
    float gLng = 1.0 - smoothstep(0.0, 0.08, abs(fract(lng / 15.0 + 0.5) - 0.5) * 15.0);
    float grid = max(gLat, gLng) * 0.03;
    gl_FragColor = vec4(uCore + uRim * (fres * 0.5 + grid), 1.0);
  }`;

const HALO_FRAG = /* glsl */ `
  uniform vec3 uRim; varying vec3 vNormal;
  void main() {
    float i = pow(max(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 6.0);
    gl_FragColor = vec4(uRim, 1.0) * clamp(i * 1.3, 0.0, 1.0);
  }`;

const DOT_VERT = /* glsl */ `
  attribute float aIndia; attribute float aSeed;
  uniform float uTime; uniform float uSize; uniform float uPixelRatio;
  varying float vA; varying float vIndia;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(world.xyz);
    vec3 toCam = normalize(cameraPosition - world.xyz);
    float facing = dot(n, toCam);
    vec4 mv = viewMatrix * world;
    float tw = 0.78 + 0.22 * sin(uTime * 1.3 + aSeed * 6.2831);
    vA = smoothstep(0.02, 0.35, facing) * tw;
    vIndia = aIndia;
    gl_PointSize = clamp(uSize * 1.6 * uPixelRatio * (1.0 + aIndia * 0.25) / -mv.z, 1.1 * uPixelRatio, 4.5 * uPixelRatio);
    gl_Position = projectionMatrix * mv;
  }`;

const DOT_FRAG = /* glsl */ `
  uniform vec3 uLand; uniform vec3 uIndia; uniform float uFocus;
  varying float vA; varying float vIndia;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.1, d);
    vec3 col = mix(uLand, uIndia, vIndia * uFocus);
    float a = core * vA * mix(0.6, 0.85, vIndia * uFocus);
    gl_FragColor = vec4(col, a);
  }`;

export const GLOBE_COLORS = {
  core: new Color('#030b16'),
  rim: new Color('#62d6f2'),
  land: new Color('#4fb8d8'),
  india: new Color('#a9ecff'),
};

export interface Globe {
  readonly group: Group;
  update(time: number): void;
  /** 0 = India drawn like everywhere else, 1 = India highlighted */
  setFocus(v: number): void;
  rebuildDots(count: number, pixelRatio: number): void;
  dispose(): void;
}

export function createGlobe(mask: LandMask, dotCount: number, pixelRatio: number): Globe {
  const group = new Group();
  const bodyUniforms = { uCore: { value: GLOBE_COLORS.core }, uRim: { value: GLOBE_COLORS.rim }, uTime: { value: 0 } };
  const body = new Mesh(new SphereGeometry(1, 128, 96), new ShaderMaterial({ vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, uniforms: bodyUniforms }));
  const halo = new Mesh(new SphereGeometry(1.1, 96, 64), new ShaderMaterial({
    vertexShader: BODY_VERT, fragmentShader: HALO_FRAG, uniforms: { uRim: { value: GLOBE_COLORS.rim } },
    side: BackSide, transparent: true, blending: AdditiveBlending, depthWrite: false,
  }));
  group.add(halo, body);

  const dotUniforms = {
    uTime: { value: 0 }, uSize: { value: 3.1 }, uPixelRatio: { value: pixelRatio },
    uLand: { value: GLOBE_COLORS.land }, uIndia: { value: GLOBE_COLORS.india }, uFocus: { value: 1 },
  };
  const dotMaterial = new ShaderMaterial({
    vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, uniforms: dotUniforms,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  let dots: Points | null = null;

  const buildDots = (count: number) => {
    const pos: number[] = [];
    const india: number[] = [];
    const seed: number[] = [];
    for (let i = 0; i < count; i++) {
      const [lng, lat] = fibonacciLngLat(count, i);
      const s = sampleMask(mask, lng, lat);
      if (!s.land) continue;
      const v = lngLatToVec3(lng, lat, 1.0015);
      pos.push(v.x, v.y, v.z);
      india.push(s.india ? 1 : 0);
      seed.push((i * 0.618034) % 1);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('aIndia', new BufferAttribute(new Float32Array(india), 1));
    geo.setAttribute('aSeed', new BufferAttribute(new Float32Array(seed), 1));
    const next = new Points(geo, dotMaterial);
    next.renderOrder = 2;
    if (dots) { group.remove(dots); dots.geometry.dispose(); }
    dots = next;
    group.add(dots);
  };
  buildDots(dotCount);

  return {
    group,
    update(time) { bodyUniforms.uTime.value = time; dotUniforms.uTime.value = time; },
    setFocus(v) { dotUniforms.uFocus.value = v; },
    rebuildDots(count, pr) { dotUniforms.uPixelRatio.value = pr; buildDots(count); },
    dispose() {
      body.geometry.dispose(); (body.material as ShaderMaterial).dispose();
      halo.geometry.dispose(); (halo.material as ShaderMaterial).dispose();
      dots?.geometry.dispose(); dotMaterial.dispose();
    },
  };
}
