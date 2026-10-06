import { Color, DoubleSide, ShaderMaterial, Texture, Vector2, Vector3, Vector4 } from 'three';
import { paletteArray } from '../living-earth/land-classes';
import { writesTileLand } from '../layers/stencil';

/**
 * Land tile look: the Living Earth recipe of the globe's land dots (globe/globe.ts): class colour, green classes
 * breathing with the month's NDVI, canopy from tree cover, relief from hillshade.
 * - Class edges: a bilinear membership field over the 4 nearest texels, cut with screen-space anti-aliasing, so a
 *   border is crisp at any zoom but follows rounded contours instead of texel squares (no mush on coarse levels);
 *   continuous channels (tree, hillshade, NDVI) stay bilinear.
 * - Close in (uDetail > 0, never on the base tier): per-material texture (canopy clumps, grass grain, water
 *   ripples, bare speckle). Surface texture only: it never changes a class or a value (style guide).
 * - Real colour (uReal > 0): our Sentinel-2 true-colour mosaic where the tile has one.
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
  uniform sampler2D uLand; uniform vec3 uSrc; uniform vec4 uBounds; uniform vec2 uOrigin;
  uniform sampler2D uNdvi; uniform float uHasNdvi; uniform vec3 uNdviSrc; uniform sampler2D uRgb; uniform float uHasRgb;
  uniform sampler2D uSurface; uniform vec2 uGrid; uniform vec2 uHalf; uniform vec2 uT0; uniform vec2 uT1; uniform float uW;
  uniform float uM0; uniform float uM1;
  uniform vec3 uPalette[12]; uniform float uNdviLo; uniform float uNdviHi;
  uniform float uAlpha; uniform float uFade; uniform float uGain; uniform vec3 uRim;
  uniform float uDetail; uniform float uReal; uniform float uTime;
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;

  vec3 tapSurface(vec2 tile, vec2 uv) { return texture(uSurface, (tile + clamp(uv, uHalf, 1.0 - uHalf)) / uGrid).rgb; }
  float ndviAt(vec2 suv, vec2 lngLat) {
    if (uHasNdvi > 0.5) {
      vec2 h = vec2(0.5 / 64.0);
      vec2 f = clamp(uNdviSrc.yz + suv * uNdviSrc.x, h, 1.0 - h); // an ancestor's sub-rectangle at town levels
      vec2 c0 = vec2(mod(uM0, 4.0), floor(uM0 / 4.0)); vec2 c1 = vec2(mod(uM1, 4.0), floor(uM1 / 4.0));
      float b0 = texture(uNdvi, (c0 + f) / vec2(4.0, 3.0)).r; float b1 = texture(uNdvi, (c1 + f) / vec2(4.0, 3.0)).r;
      if (b0 > 0.5 / 255.0 && b1 > 0.5 / 255.0) return uNdviLo + (mix(b0, b1, uW) * 255.0 - 1.0) / 254.0 * (uNdviHi - uNdviLo);
    }
    vec2 uv = vec2((lngLat.x + 180.0) / 360.0, (90.0 - lngLat.y) / 180.0);
    return mix(tapSurface(uT0, uv).b, tapSurface(uT1, uv).b, uW) * (uNdviHi - uNdviLo) + uNdviLo;
  }
  bool isGreen(int c) { return c == 1 || c == 2 || c == 3 || c == 4 || c == 9 || c == 10; }
  vec3 classColour(int cls, float tree, float shade, float green) {
    float life = isGreen(cls) ? mix(0.22, 1.2, green) : 1.0;
    float canopy = cls == 1 ? mix(0.55, 1.0, tree) : 1.0;
    return uPalette[clamp(cls, 0, 11)] * life * canopy * mix(0.55, 1.35, shade);
  }

  // periodic value noise on a lattice of 4096 cells per degree (~27 m), period 1 degree: seamless across tiles
  float hash(vec2 p) { p = mod(p, 4096.0); return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float detail(int cls, vec2 deg) {
    vec2 p = deg * 4096.0;
    if (cls == 1 || cls == 10) return 1.0 + 0.22 * (vnoise(p * 0.5) + 0.5 * vnoise(p * 2.0) - 0.75);        // canopy clumps
    if (cls == 2 || cls == 3 || cls == 4 || cls == 9) return 1.0 + 0.12 * (vnoise(p * vec2(4.0, 1.0)) - 0.5); // grass and field grain
    if (cls == 8) return 1.0 + 0.16 * (vnoise(p * 0.7 + vec2(uTime * 0.6, uTime * 0.35)) - 0.5);              // water ripples
    if (cls == 6 || cls == 5) return 1.0 + 0.1 * (vnoise(p * 3.0) - 0.5);                                     // bare speckle, town grain
    return 1.0;
  }

  void main() {
    vec2 suv = uSrc.yz + vUv * uSrc.x;
    vec2 lngLat = vec2(mix(uBounds.x, uBounds.z, vUv.x), mix(uBounds.w, uBounds.y, vUv.y));
    float green = smoothstep(0.05, 0.8, ndviAt(suv, lngLat));
    vec2 p = suv * 256.0 - 0.5;
    ivec2 i0 = ivec2(floor(p)); vec2 f = fract(p);
    ivec2 o[4] = ivec2[4](ivec2(0, 0), ivec2(1, 0), ivec2(0, 1), ivec2(1, 1));
    float w[4] = float[4]((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
    int c[4]; float tree = 0.0; float shade = 0.0;
    for (int k = 0; k < 4; k++) {
      vec3 l = texelFetch(uLand, clamp(i0 + o[k], ivec2(0), ivec2(255)), 0).rgb;
      c[k] = int(l.r * 255.0 + 0.5); tree += l.g * w[k]; shade += l.b * w[k];
    }
    // membership of each tap's class in the bilinear field: the strongest class wins, the runner-up blends at the edge
    int best = c[0]; float mBest = -1.0; int second = c[0]; float mSecond = -1.0;
    for (int k = 0; k < 4; k++) {
      float m = 0.0;
      for (int j = 0; j < 4; j++) m += c[j] == c[k] ? w[j] : 0.0;
      if (c[k] == best && mBest >= 0.0) continue;
      if (m > mBest) { if (mBest >= 0.0) { second = best; mSecond = mBest; } best = c[k]; mBest = m; }
      else if (c[k] != best && c[k] != second && m > mSecond) { second = c[k]; mSecond = m; }
      else if (c[k] == second) { mSecond = max(mSecond, m); }
    }
    if (mSecond < 0.0) { second = best; mSecond = 0.0; }
    float d = mBest - mSecond;
    float aa = max(fwidth(d) * 1.2, 0.02);
    float t = clamp(0.5 + d / (2.0 * aa), 0.0, 1.0); // share of the winning class at this pixel
    float land = best != 0 ? (second != 0 ? 1.0 : t) : (second != 0 ? 1.0 - t : 0.0);
    if (land < 0.5) discard;
    vec3 colBest = classColour(best != 0 ? best : second, tree, shade, green);
    vec3 colSecond = second != 0 ? classColour(second, tree, shade, green) : colBest;
    vec3 col = mix(colSecond, colBest, t);
    int shown = t >= 0.5 && best != 0 ? best : second;
    if (uDetail > 0.001) {
      vec2 deg = uOrigin + vUv * vec2(uBounds.z - uBounds.x, uBounds.y - uBounds.w);
      col *= mix(1.0, detail(shown, deg), uDetail);
    }
    col *= uGain;
    if (uReal > 0.001 && uHasRgb > 0.5) {
      vec3 rgb = texture(uRgb, suv).rgb;
      if (dot(rgb, vec3(1.0)) > 0.04) { // 0 = no colour tile data there (jpeg lifts it a little)
        // display grade: lift MODIS/Sentinel haze (saturation), keep relief from the hillshade, and stay under
        // the bloom threshold (core/stage.ts, 0.55) so bright fields don't glow like city lights
        vec3 lin = pow(rgb, vec3(2.2));
        float lum = dot(lin, vec3(0.2126, 0.7152, 0.0722));
        lin = max(mix(vec3(lum), lin, 1.35), 0.0) * 0.8;
        // coarse levels carry hillshade exaggerated up to 8x (tile_raster.exaggeration) for the class view; at full
        // strength it darkened real colour from space, so relief weighs in only as tiles get fine (level 4 -> 7)
        float level = log2(180.0 / max(1e-9, uBounds.z - uBounds.x));
        lin *= 1.0 + (shade - 0.71) * mix(0.2, 0.8, smoothstep(4.0, 7.0, level)); // 181/255 = flat
        col = mix(col, min(lin, vec3(0.45)), uReal);
      }
    }
    float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);
    // the hologram rim glow tips bright desert at the limb over the bloom threshold; keep a trace of it in real colour
    gl_FragColor = vec4(col + uRim * fres * 0.35 * (1.0 - 0.85 * uReal), uAlpha * uFade);
  }`;

/** Uniforms every tile shares (month, surface atlas, fade); materials hold references so one update reaches all. */
export function sharedUniforms() {
  return {
    uSurface: { value: null as Texture | null }, uGrid: { value: new Vector2(4, 3) }, uHalf: { value: new Vector2(0.5 / 1024, 0.5 / 512) },
    uT0: { value: new Vector2() }, uT1: { value: new Vector2() }, uW: { value: 0 }, uM0: { value: 0 }, uM1: { value: 0 },
    uPalette: { value: Array.from({ length: 12 }, (_, i) => new Color(...Array.from(paletteArray().slice(i * 3, i * 3 + 3)) as [number, number, number])) },
    uNdviLo: { value: -0.2 }, uNdviHi: { value: 0.9 },
    uAlpha: { value: 1 }, uGain: { value: 0.44 }, uRim: { value: new Color('#62d6f2') },
    uDetail: { value: 0 }, uReal: { value: 0 }, uTime: { value: 0 },
  };
}
export type SharedUniforms = ReturnType<typeof sharedUniforms>;

export interface TileTextures {
  readonly land: Texture; readonly ndvi: Texture | null; readonly rgb: Texture | null;
  readonly ndviUv?: { readonly scale: number; readonly u: number; readonly v: number } | null;
}

/** `origin`: the tile's west and north edge in degrees mod 1 (computed in double precision) for seamless detail noise. */
export function tileMaterial(shared: SharedUniforms, tex: TileTextures, src: Vector3, b: Vector4, origin: Vector2): ShaderMaterial {
  const m = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: DoubleSide, transparent: true, depthWrite: true,
    uniforms: {
      ...shared, uLand: { value: tex.land }, uNdvi: { value: tex.ndvi }, uHasNdvi: { value: tex.ndvi ? 1 : 0 },
      uNdviSrc: { value: new Vector3(tex.ndviUv?.scale ?? 1, tex.ndviUv?.u ?? 0, tex.ndviUv?.v ?? 0) },
      uRgb: { value: tex.rgb }, uHasRgb: { value: tex.rgb ? 1 : 0 }, uFade: { value: 1 }, uSrc: { value: src }, uBounds: { value: b }, uOrigin: { value: origin },
    },
  });
  writesTileLand(m); // ocean pixels are discarded, so only land marks the stencil
  return m;
}
