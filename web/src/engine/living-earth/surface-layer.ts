import { AdditiveBlending, Color, DataTexture, LinearFilter, Mesh, ShaderMaterial, SphereGeometry, Texture, Vector2 } from 'three';
import type { LandMask } from '../globe/mask';
import { LAYER_ORDER } from '../layers/order';
import { onTileLand } from '../layers/stencil';
import { SHOWN, SNOW_THRESHOLD, WATER_THRESHOLD } from './motion';
import { channel, monthBlend, tileOf, type PackManifest } from './pack';

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
 * One shell for both surface materials. Month m0 and m1 come from the atlas and crossfade by uW.
 * Water brightens with the share of each cell under water, and open water (over half the cell) ripples;
 * snow shows from 40 % cover, per the style guide.
 */
const FRAG = /* glsl */ `
  uniform sampler2D uAtlas; uniform sampler2D uLand; uniform vec2 uGrid; uniform vec2 uHalf;
  uniform vec2 uT0; uniform vec2 uT1; uniform float uW;
  uniform float uWaterT; uniform float uSnowT;
  uniform vec3 uWaterColor; uniform vec3 uSnowColor;
  uniform float uWater; uniform float uSnow; uniform float uFx; uniform float uTime;
  varying vec3 vPos; varying vec3 vNormal; varying vec3 vView;

  vec3 tap(vec2 tile, vec2 uv) { return texture2D(uAtlas, (tile + clamp(uv, uHalf, 1.0 - uHalf)) / uGrid).rgb; }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float edge(float v, float t) { float w = max(fwidth(v), 0.004); return smoothstep(t - w, t + w, v); }

  void main() {
    vec3 p = normalize(vPos);
    float lng = mod(degrees(atan(p.z, -p.x)), 360.0);
    vec2 uv = vec2(lng / 360.0, (90.0 - degrees(asin(clamp(p.y, -1.0, 1.0)))) / 180.0);
    vec3 s = mix(tap(uT0, uv), tap(uT1, uv), uW);
    // JRC maps near-shore sea as water too; the globe's land mask keeps both materials on land.
    float land = smoothstep(0.75, 1.0, texture2D(uLand, uv).r);
    float facing = clamp(dot(vNormal, vView), 0.0, 1.0);
    float limb = smoothstep(0.02, 0.3, facing);

    // s.r is the share of the cell under water; brightness rises with it, eased so big rivers still read.
    float share = clamp((s.r - 0.05) / 0.95, 0.0, 1.0);
    float openW = edge(s.r, uWaterT);
    float ripple = uFx * 0.12 * openW * sin(uTime * 0.6 + hash(floor(uv * 2048.0)) * 6.2831);
    float wa = uWater * land * (0.55 * pow(share, 0.6) + 0.12 * openW + ripple);

    float snow = edge(s.g, uSnowT);
    vec2 cell = floor(uv * vec2(2048.0, 1024.0));
    float glint = uFx * step(0.996, hash(cell)) * pow(0.5 + 0.5 * sin(uTime * 1.1 + hash(cell + 7.0) * 40.0), 12.0);
    float sa = uSnow * land * snow * (0.22 + 0.2 * smoothstep(uSnowT, 1.0, s.g) + glint);

    vec3 col = uWaterColor * wa + uSnowColor * sa;
    gl_FragColor = vec4(col * limb, 1.0);
  }`;

export const SURFACE_COLORS = { water: new Color('#62d6f2'), snow: new Color('#d9f2ff') };
const RADIUS = 1.0008;

/** Seasonal water and snow from the globe pack, drawn in the hologram look. */
export class SurfaceLayer {
  readonly mesh: Mesh;
  readonly texture: Texture;
  private readonly land: DataTexture;
  private readonly uniforms: Record<string, { value: unknown }>;
  private readonly t0 = new Vector2();
  private readonly t1 = new Vector2();

  constructor(private readonly manifest: PackManifest, atlas: ImageBitmap, mask: LandMask, materialFx: boolean) {
    this.texture = new Texture(atlas);
    this.texture.flipY = false;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.needsUpdate = true;
    // the GPU keeps the atlas; free the decoded bitmap once it is uploaded
    this.texture.onUpdate = () => atlas.close();
    this.land = new DataTexture(new Uint8Array(mask.data), mask.width, mask.height);
    this.land.minFilter = LinearFilter;
    this.land.magFilter = LinearFilter;
    this.land.needsUpdate = true;
    const { cols, rows } = manifest.layout;
    const [w, h] = manifest.surface.month;
    const norm = (name: string, v: number) => { const c = channel(manifest.surface, name); return (v - c.lo) / (c.hi - c.lo); };
    this.uniforms = {
      uAtlas: { value: this.texture }, uLand: { value: this.land }, uGrid: { value: new Vector2(cols, rows) }, uHalf: { value: new Vector2(0.5 / w, 0.5 / h) },
      uT0: { value: this.t0 }, uT1: { value: this.t1 }, uW: { value: 0 },
      uWaterT: { value: norm('water', WATER_THRESHOLD) }, uSnowT: { value: norm('snow', SNOW_THRESHOLD) },
      uWaterColor: { value: SURFACE_COLORS.water }, uSnowColor: { value: SURFACE_COLORS.snow },
      uWater: { value: 0 }, uSnow: { value: 0 }, uFx: { value: materialFx ? 1 : 0 }, uTime: { value: 0 },
    };
    this.mesh = new Mesh(new SphereGeometry(RADIUS, 192, 128), new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    }));
    this.mesh.renderOrder = LAYER_ORDER.water;
  }

  /** Channel strengths 0..1 for water and snow; the layer hides itself when both are off. */
  set(water: number, snow: number): void {
    this.uniforms.uWater!.value = water;
    this.uniforms.uSnow!.value = snow;
    this.mesh.visible = water > SHOWN || snow > SHOWN;
  }

  setMaterialFx(on: boolean): void { this.uniforms.uFx!.value = on ? 1 : 0; }

  /** Draw only on tile land (stencil): JRC counts near-shore sea as water, and the ~20 km land mask let it show. */
  setTileMask(on: boolean): void { onTileLand(this.mesh.material as ShaderMaterial, on); }


  update(t: number, time: number): void {
    const { m0, m1, w } = monthBlend(t);
    this.t0.fromArray(tileOf(m0, this.manifest.layout));
    this.t1.fromArray(tileOf(m1, this.manifest.layout));
    this.uniforms.uW!.value = w;
    this.uniforms.uTime!.value = time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
    this.texture.dispose();
    this.land.dispose();
  }
}
