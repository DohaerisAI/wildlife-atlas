import { Color, DoubleSide, ShaderMaterial, Texture, Vector2, Vector3, Vector4 } from 'three';
import { paletteArray } from '../living-earth/land-classes';

/**
 * Land tile look: the same Living Earth recipe as the globe's land dots (globe/globe.ts DOT_VERT): class colour,
 * green classes breathing with the month's NDVI, canopy from tree cover, relief from hillshade. Four texel taps
 * are coloured and blended by hand so class borders and coasts stay smooth when a tile is magnified.
 */
const VERT = /* glsl */ `
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(world.xyz);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uLand; uniform vec3 uSrc; uniform vec4 uBounds;
  uniform sampler2D uNdvi; uniform float uHasNdvi;
  uniform sampler2D uSurface; uniform vec2 uGrid; uniform vec2 uHalf; uniform vec2 uT0; uniform vec2 uT1; uniform float uW;
  uniform float uM0; uniform float uM1;
  uniform vec3 uPalette[12]; uniform float uNdviLo; uniform float uNdviHi;
  uniform float uAlpha; uniform float uFade; uniform float uGain; uniform vec3 uRim;
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;

  vec3 tapSurface(vec2 tile, vec2 uv) { return texture(uSurface, (tile + clamp(uv, uHalf, 1.0 - uHalf)) / uGrid).rgb; }
  float ndviAt(vec2 suv, vec2 lngLat) {
    if (uHasNdvi > 0.5) {
      vec2 h = vec2(0.5 / 64.0);
      vec2 f = clamp(suv, h, 1.0 - h);
      vec2 c0 = vec2(mod(uM0, 4.0), floor(uM0 / 4.0)); vec2 c1 = vec2(mod(uM1, 4.0), floor(uM1 / 4.0));
      float b0 = texture(uNdvi, (c0 + f) / vec2(4.0, 3.0)).r; float b1 = texture(uNdvi, (c1 + f) / vec2(4.0, 3.0)).r;
      if (b0 > 0.5 / 255.0 && b1 > 0.5 / 255.0) {
        float b = mix(b0, b1, uW) * 255.0;
        return uNdviLo + (b - 1.0) / 254.0 * (uNdviHi - uNdviLo);
      }
    }
    vec2 uv = vec2((lngLat.x + 180.0) / 360.0, (90.0 - lngLat.y) / 180.0);
    return mix(tapSurface(uT0, uv).b, tapSurface(uT1, uv).b, uW) * (uNdviHi - uNdviLo) + uNdviLo;
  }
  vec4 look(ivec2 p, float green) {
    vec3 l = texelFetch(uLand, clamp(p, ivec2(0), ivec2(255)), 0).rgb;
    int cls = int(l.r * 255.0 + 0.5);
    bool greenClass = cls == 1 || cls == 2 || cls == 3 || cls == 4 || cls == 9 || cls == 10;
    float life = greenClass ? mix(0.22, 1.2, green) : 1.0;
    float canopy = cls == 1 ? mix(0.55, 1.0, l.g) : 1.0;
    float relief = mix(0.55, 1.35, l.b);
    float land = cls > 0 ? 1.0 : 0.0;
    return vec4(uPalette[clamp(cls, 0, 11)] * life * canopy * relief * land, land);
  }
  void main() {
    vec2 suv = uSrc.yz + vUv * uSrc.x;
    vec2 lngLat = vec2(mix(uBounds.x, uBounds.z, vUv.x), mix(uBounds.w, uBounds.y, vUv.y));
    float green = smoothstep(0.05, 0.8, ndviAt(suv, lngLat));
    vec2 p = suv * 256.0 - 0.5;
    ivec2 i0 = ivec2(floor(p)); vec2 f = fract(p);
    vec4 a = look(i0, green), b = look(i0 + ivec2(1, 0), green), c = look(i0 + ivec2(0, 1), green), d = look(i0 + ivec2(1, 1), green);
    vec4 m = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    if (m.a < 0.5) discard;
    // premultiplied taps: divide out the ocean share so the coast keeps the land colour
    vec3 col = m.rgb / max(m.a, 1e-3) * uGain;
    float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);
    gl_FragColor = vec4(col + uRim * fres * 0.35, uAlpha * uFade);
  }`;

/** Uniforms every tile shares (month, surface atlas, fade); materials hold references so one update reaches all. */
export function sharedUniforms() {
  return {
    uSurface: { value: null as Texture | null }, uGrid: { value: new Vector2(4, 3) }, uHalf: { value: new Vector2(0.5 / 1024, 0.5 / 512) },
    uT0: { value: new Vector2() }, uT1: { value: new Vector2() }, uW: { value: 0 }, uM0: { value: 0 }, uM1: { value: 0 },
    uPalette: { value: Array.from({ length: 12 }, (_, i) => new Color(...Array.from(paletteArray().slice(i * 3, i * 3 + 3)) as [number, number, number])) },
    uNdviLo: { value: -0.2 }, uNdviHi: { value: 0.9 },
    uAlpha: { value: 1 }, uGain: { value: 0.44 }, uRim: { value: new Color('#62d6f2') },
  };
}
export type SharedUniforms = ReturnType<typeof sharedUniforms>;

export function tileMaterial(shared: SharedUniforms, land: Texture, ndvi: Texture | null, src: Vector3, b: Vector4): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: DoubleSide, transparent: true, depthWrite: true,
    uniforms: { ...shared, uLand: { value: land }, uNdvi: { value: ndvi }, uHasNdvi: { value: ndvi ? 1 : 0 }, uFade: { value: 1 }, uSrc: { value: src }, uBounds: { value: b } },
  });
}
