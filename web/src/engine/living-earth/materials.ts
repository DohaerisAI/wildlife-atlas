import type { PerspectiveCamera, Scene } from 'three';
import type { TierSettings } from '../core/tiers';
import type { LandMask } from '../globe/mask';
import { SHOWN } from './motion';
import { sampleMask } from '../globe/mask';
import { channel, loadPack, type PackManifest } from './pack';
import type { EnvReading, EnvReadingV2 } from './reading';
import { attachWorldV2, type WorldChannels, type WorldV2 } from './world-v2';
import { isV2, loadPackV2 } from './pack-v2';
import type { Globe } from '../globe/globe';
import { sampleValue, type MonthlyPixels } from './sampler';
import { SurfaceLayer } from './surface-layer';
import { WindLayer } from './wind-layer';

/** Story channels (0..1) that switch the first Living Earth materials on. */
export const MATERIAL_CHANNELS = ['water', 'snow', 'wind'] as const;
export type MaterialChannels = Readonly<Record<(typeof MATERIAL_CHANNELS)[number], number>> & Partial<WorldChannels>;

const LABELS: Record<(typeof MATERIAL_CHANNELS)[number], string> = {
  water: 'Surface water (JRC Global Surface Water)',
  snow: 'Snow (MODIS, 2015–2024 mean)',
  wind: 'Wind (ERA5, 1991–2020 mean)',
};

/** What is on the globe and where it comes from ("Real" law: every moving thing names its dataset). */
export function envCaption(ch: MaterialChannels): string {
  const on = MATERIAL_CHANNELS.filter((k) => ch[k] > SHOWN).map((k) => LABELS[k]);
  return on.join(' · ');
}

export interface LivingEarth {
  readonly manifest: PackManifest;
  update(t: number, time: number, dt: number, ch: MaterialChannels, camera: PerspectiveCamera): void;
  setTier(s: TierSettings): void;
  /** Real values at a place and month (needs the pack loaded with `probe: true`). */
  sample(lng: number, lat: number, t: number): { reading: EnvReading; onLand: boolean; v2: EnvReadingV2 | null } | null;
  /** true when pack v2 layers (land, ocean, relief, lights) are on the globe */
  readonly hasWorld: boolean;
  dispose(): void;
}

const surfaceFits = (m: PackManifest, maxTexture: number) => {
  const [w, h] = m.surface.month;
  return w * m.layout.cols <= maxTexture && h * m.layout.rows <= maxTexture;
};

/** Load the globe pack and add water, snow and wind to the scene. Rejects if the pack is missing or invalid. */
export async function createLivingEarth(baseUrl: string, scene: Scene, mask: LandMask, s: TierSettings, maxTexture: number, reduced: boolean, probe = false, globe: Globe | null = null): Promise<LivingEarth> {
  const first = await loadPack(baseUrl, probe);
  const v2 = isV2(first.manifest) ? await loadPackV2(baseUrl, probe) : null;
  const pack = v2 ?? first;
  const { manifest } = pack;
  const u = channel(manifest.climate, 'wind_u');
  const v = channel(manifest.climate, 'wind_v');
  const wind = new WindLayer({
    data: pack.climatePixels, atlasWidth: pack.climate.width, month: manifest.climate.month, layout: manifest.layout, u, v,
  }, s.windStreaks, reduced);
  pack.climate.close();
  const surface = surfaceFits(manifest, maxTexture) ? new SurfaceLayer(manifest, pack.surface, mask, s.materialFx && !reduced) : null;
  if (!surface) console.warn(`Living Earth surface atlas exceeds this GPU's ${maxTexture}px texture limit; water and snow are off`);
  if (surface) scene.add(surface.mesh);
  scene.add(wind.lines);

  let world: WorldV2 | null = null;
  if (surface && v2) world = attachWorldV2(v2, surface.texture, scene, globe, mask, s, reduced);

  const climatePx: MonthlyPixels = { data: pack.climatePixels, atlasWidth: pack.climate.width, month: manifest.climate.month, layout: manifest.layout };
  const surfacePx: MonthlyPixels | null = pack.surfacePixels
    ? { data: pack.surfacePixels, atlasWidth: manifest.surface.month[0] * manifest.layout.cols, month: manifest.surface.month, layout: manifest.layout }
    : null;
  const sc = (name: string) => channel(manifest.surface, name);
  const temp = channel(manifest.climate, 'temp');

  return {
    manifest,
    hasWorld: world !== null,
    sample(lng, lat, t) {
      if (!surfacePx) return null;
      const reading: EnvReading = {
        windU: sampleValue(climatePx, 0, u, lng, lat, t), windV: sampleValue(climatePx, 1, v, lng, lat, t), tempC: sampleValue(climatePx, 2, temp, lng, lat, t),
        waterPct: sampleValue(surfacePx, 0, sc('water'), lng, lat, t), snowPct: sampleValue(surfacePx, 1, sc('snow'), lng, lat, t), ndvi: sampleValue(surfacePx, 2, sc('ndvi'), lng, lat, t),
      };
      return { reading, onLand: sampleMask(mask, lng, lat).land, v2: world?.sample(lng, lat, t) ?? null };
    },
    update(t, time, dt, ch, camera) {
      surface?.set(ch.water, ch.snow);
      surface?.update(t, time);
      wind.setOpacity(ch.wind);
      wind.update(t, dt, camera);
      world?.update(t, dt, { land: ch.land ?? 0, currents: ch.currents ?? 0, blooms: ch.blooms ?? 0, lights: ch.lights ?? 0, depth: ch.depth ?? 0 }, camera);
    },
    setTier(next) {
      surface?.setMaterialFx(next.materialFx && !reduced);
      wind.resize(next.windStreaks);
      world?.setTier(next);
    },
    dispose() {
      if (surface) { scene.remove(surface.mesh); surface.dispose(); }
      scene.remove(wind.lines);
      wind.dispose();
      world?.dispose();
    },
  };
}
