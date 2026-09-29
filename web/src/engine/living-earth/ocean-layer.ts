import { AdditiveBlending, Color, Mesh, ShaderMaterial, SphereGeometry, Texture, Vector2, Vector3 } from 'three';
import { lngLatToVec3 } from '../globe/geo';
import { LAYER_ORDER } from '../layers/order';
import { monthBlend, tileOf } from './pack';

const VERT = /* glsl */ `
  varying vec3 vPos; varying vec3 vNormal; varying vec3 vView;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPos = position;
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-(viewMatrix * world).xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

/**
 * Ocean and night (style guide layers 1 and 7): continental shelves glow faintly from bathymetry,
 * plankton blooms brighten with log chlorophyll, and city lights show only where it is night.
 */
const FRAG = /* glsl */ `
  uniform sampler2D uOcean; uniform vec2 uGrid; uniform vec2 uHalf; uniform vec2 uT0; uniform vec2 uT1; uniform float uW;
  uniform sampler2D uRelief; uniform vec3 uSun;
  uniform sampler2D uLandTex; uniform vec3 uPalette[12]; uniform float uWash;
  uniform float uDepth; uniform float uBloom; uniform float uLights; uniform float uElevLo;
  uniform vec3 uShelf; uniform vec3 uBloomColor; uniform vec3 uLightColor;
  varying vec3 vPos; varying vec3 vNormal; varying vec3 vView;

  vec3 tap(vec2 tile, vec2 uv) { return texture2D(uOcean, (tile + clamp(uv, uHalf, 1.0 - uHalf)) / uGrid).rgb; }

  void main() {
    vec3 p = normalize(vPos);
    vec2 uv = vec2(mod(degrees(atan(p.z, -p.x)), 360.0) / 360.0, (90.0 - degrees(asin(clamp(p.y, -1.0, 1.0)))) / 180.0);
    vec3 r = texture2D(uRelief, uv).rgb;
    float elev = (r.r * 65280.0 + r.g * 255.0) + uElevLo; // 16-bit metres, offset
    float limb = smoothstep(0.02, 0.3, clamp(dot(vNormal, vView), 0.0, 1.0));
    float sea = step(elev, 0.0);

    // shelves (0 to -200 m) glow, the deep ocean stays dark
    float shelf = sea * (1.0 - smoothstep(-120.0, -1500.0, elev)) * 0.07;
    // byte 0 = no data; else log10 chlorophyll -2..1.5 over bytes 1..255. Blooms from ~0.5 mg/m3 (log -0.3).
    vec2 c0 = vec2(tap(uT0, uv).b, tap(uT1, uv).b);
    float chl = mix(c0.x, c0.y, uW);
    float valid = step(0.5 / 255.0, min(c0.x, c0.y));
    float logChl = -2.0 + (chl * 255.0 - 1.0) / 254.0 * 3.5;
    float bloom = sea * valid * smoothstep(-0.3, 0.8, logChl) * 0.22;
    float night = smoothstep(0.08, -0.12, dot(p, uSun));
    float lights = (1.0 - sea) * night * pow(r.b, 1.6) * 0.9;

    // faint class-coloured wash under the land dots, lit by the hillshade, so fields read from space
    vec3 lt = texture2D(uLandTex, uv).rgb;
    int cls = int(lt.r * 255.0 + 0.5);
    vec3 wash = (1.0 - sea) * uPalette[clamp(cls, 0, 11)] * mix(0.5, 1.3, lt.b) * 0.13 * uWash;
    vec3 col = wash + uShelf * shelf * uDepth + uBloomColor * bloom * uBloom + uLightColor * lights * uLights;
    gl_FragColor = vec4(col * limb, 1.0);
  }`;

export interface OceanTextures {
  readonly ocean: Texture;
  readonly relief: Texture;
  readonly land: Texture;
  readonly palette: readonly Color[];
  readonly grid: readonly [number, number];
  readonly half: readonly [number, number];
  readonly layout: { readonly cols: number };
  /** metres added to decode relief elevation (16-bit value + this) */
  readonly elevLo: number;
}

export const OCEAN_COLORS = { shelf: new Color('#62d6f2'), bloom: new Color('#73f0b8'), lights: new Color('#fff1d6') };

export class OceanLayer {
  readonly mesh: Mesh;
  private readonly u: Record<string, { value: unknown }>;
  private readonly t0 = new Vector2();
  private readonly t1 = new Vector2();
  private readonly sun = new Vector3();

  constructor(private readonly tex: OceanTextures) {
    this.u = {
      uOcean: { value: tex.ocean }, uRelief: { value: tex.relief }, uGrid: { value: new Vector2(...tex.grid) }, uHalf: { value: new Vector2(...tex.half) },
      uT0: { value: this.t0 }, uT1: { value: this.t1 }, uW: { value: 0 }, uSun: { value: this.sun }, uElevLo: { value: tex.elevLo },
      uDepth: { value: 1 }, uBloom: { value: 1 }, uLights: { value: 1 }, uWash: { value: 1 },
      uLandTex: { value: tex.land }, uPalette: { value: tex.palette },
      uShelf: { value: OCEAN_COLORS.shelf }, uBloomColor: { value: OCEAN_COLORS.bloom }, uLightColor: { value: OCEAN_COLORS.lights },
    };
    this.mesh = new Mesh(new SphereGeometry(1.0006, 160, 112), new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, transparent: true, depthWrite: false, blending: AdditiveBlending,
    }));
    this.mesh.renderOrder = LAYER_ORDER.ocean;
  }

  set(ch: { depth: number; bloom: number; lights: number; wash: number }): void {
    this.u.uDepth!.value = ch.depth; this.u.uBloom!.value = ch.bloom; this.u.uLights!.value = ch.lights; this.u.uWash!.value = ch.wash;
    this.mesh.visible = ch.depth + ch.bloom + ch.lights + ch.wash > 0.01;
  }

  update(t: number, sunLng: number, sunLat: number): void {
    const { m0, m1, w } = monthBlend(t);
    this.t0.fromArray(tileOf(m0, this.tex.layout));
    this.t1.fromArray(tileOf(m1, this.tex.layout));
    this.u.uW!.value = w;
    lngLatToVec3(sunLng, sunLat, 1, this.sun);
  }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}
