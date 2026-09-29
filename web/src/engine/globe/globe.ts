import {
  AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Color, Group, Mesh, Points, ShaderMaterial, SphereGeometry, Texture, Vector2,
} from 'three';
import { paletteArray } from '../living-earth/land-classes';
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
  // Living Earth land materials (pack v2): class, tree cover, hillshade; monthly NDVI from the surface atlas
  uniform float uMat; uniform sampler2D uLandTex; uniform sampler2D uSurface; uniform vec2 uGrid; uniform vec2 uHalf;
  uniform vec2 uT0; uniform vec2 uT1; uniform float uW; uniform vec3 uPalette[12]; uniform float uNdviLo; uniform float uNdviHi;
  varying float vA; varying float vIndia; varying vec3 vMat; varying float vMatOn;
  vec3 tap(vec2 tile, vec2 uv) { return texture(uSurface, (tile + clamp(uv, uHalf, 1.0 - uHalf)) / uGrid).rgb; }
  void main() {
    vec3 p = normalize(position);
    vec2 uv = vec2(mod(degrees(atan(p.z, -p.x)), 360.0) / 360.0, (90.0 - degrees(asin(clamp(p.y, -1.0, 1.0)))) / 180.0);
    vMatOn = uMat;
    vMat = vec3(0.0);
    if (uMat > 0.5) {
      vec3 l = texture(uLandTex, uv).rgb;
      int cls = int(l.r * 255.0 + 0.5);
      float ndvi = mix(tap(uT0, uv).b, tap(uT1, uv).b, uW) * (uNdviHi - uNdviLo) + uNdviLo;
      float green = smoothstep(0.05, 0.8, ndvi);
      bool greenClass = cls == 1 || cls == 2 || cls == 3 || cls == 4 || cls == 9 || cls == 10;
      vec3 base = uPalette[clamp(cls, 0, 11)];
      // green classes brighten with the month's greenness and dim as they dry: the green wave and the brown season
      float life = greenClass ? mix(0.22, 1.2, green) : 1.0;
      float canopy = cls == 1 ? mix(0.55, 1.0, l.g) : 1.0;
      float relief = mix(0.55, 1.35, l.b);
      vMat = base * life * canopy * relief;
    }
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
  uniform vec3 uLand; uniform vec3 uIndia; uniform float uFocus; uniform float uDotAlpha;
  varying float vA; varying float vIndia; varying vec3 vMat; varying float vMatOn;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.1, d);
    vec3 col = vMatOn > 0.5 ? vMat * (1.0 + vIndia * uFocus * 0.2) : mix(uLand, uIndia, vIndia * uFocus);
    float a = core * vA * mix(0.6, 0.85, vIndia * uFocus) * uDotAlpha;
    gl_FragColor = vec4(col, a);
  }`;

export const GLOBE_COLORS = {
  core: new Color('#030b16'),
  rim: new Color('#62d6f2'),
  land: new Color('#4fb8d8'),
  india: new Color('#a9ecff'),
};

export interface LandMaterials {
  readonly land: Texture;
  readonly surface: Texture;
  readonly grid: readonly [number, number];
  /** half a texel of one month tile, in tile UV */
  readonly half: readonly [number, number];
  readonly ndvi: { readonly lo: number; readonly hi: number };
}

export interface Globe {
  readonly group: Group;
  update(time: number): void;
  /** 0 = India drawn like everywhere else, 1 = India highlighted */
  setFocus(v: number): void;
  /** fade the land dots (1 = as drawn; the tiled engine fades them out close in) */
  setDotOpacity(v: number): void;
  /** colour the land dots by Living Earth land class and the month's greenness */
  setLandMaterials(m: LandMaterials | null): void;
  /** which two monthly surface tiles to blend (see living-earth/pack monthBlend) */
  setSurfaceMonth(t0: readonly [number, number], t1: readonly [number, number], w: number): void;
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
    uLand: { value: GLOBE_COLORS.land }, uIndia: { value: GLOBE_COLORS.india }, uFocus: { value: 1 }, uDotAlpha: { value: 1 },
    uMat: { value: 0 }, uLandTex: { value: null as Texture | null }, uSurface: { value: null as Texture | null },
    uGrid: { value: new Vector2(4, 3) }, uHalf: { value: new Vector2() }, uT0: { value: new Vector2() }, uT1: { value: new Vector2() }, uW: { value: 0 },
    uPalette: { value: Array.from({ length: 12 }, (_, i) => new Color(...Array.from(paletteArray().slice(i * 3, i * 3 + 3)) as [number, number, number])) },
    uNdviLo: { value: -0.2 }, uNdviHi: { value: 0.9 },
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
    setDotOpacity(v) { dotUniforms.uDotAlpha.value = v; if (dots) dots.visible = v > 0.01; },
    setLandMaterials(m) {
      dotUniforms.uMat.value = m ? 1 : 0;
      if (!m) return;
      dotUniforms.uLandTex.value = m.land;
      dotUniforms.uSurface.value = m.surface;
      dotUniforms.uGrid.value.set(m.grid[0], m.grid[1]);
      dotUniforms.uHalf.value.set(m.half[0], m.half[1]);
      dotUniforms.uNdviLo.value = m.ndvi.lo;
      dotUniforms.uNdviHi.value = m.ndvi.hi;
    },
    setSurfaceMonth(t0, t1, w) { dotUniforms.uT0.value.set(t0[0], t0[1]); dotUniforms.uT1.value.set(t1[0], t1[1]); dotUniforms.uW.value = w; },
    rebuildDots(count, pr) { dotUniforms.uPixelRatio.value = pr; buildDots(count); },
    dispose() {
      body.geometry.dispose(); (body.material as ShaderMaterial).dispose();
      halo.geometry.dispose(); (halo.material as ShaderMaterial).dispose();
      dots?.geometry.dispose(); dotMaterial.dispose();
    },
  };
}
