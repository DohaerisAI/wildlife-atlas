import type { PerspectiveCamera, Scene } from 'three';
import type { TierSettings } from '../core/tiers';
import type { LandMask } from '../globe/mask';
import { SHOWN } from './motion';
import { sampleMask } from '../globe/mask';
import { channel, loadPack, type PackManifest } from './pack';
import type { EnvReading } from './reading';
import { sampleValue, type MonthlyPixels } from './sampler';
import { SurfaceLayer } from './surface-layer';
import { WindLayer } from './wind-layer';

/** Story channels (0..1) that switch the first Living Earth materials on. */
export const MATERIAL_CHANNELS = ['water', 'snow', 'wind'] as const;
export type MaterialChannels = Readonly<Record<(typeof MATERIAL_CHANNELS)[number], number>>;

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
  sample(lng: number, lat: number, t: number): { reading: EnvReading; onLand: boolean } | null;
  dispose(): void;
}

const surfaceFits = (m: PackManifest, maxTexture: number) => {
  const [w, h] = m.surface.month;
  return w * m.layout.cols <= maxTexture && h * m.layout.rows <= maxTexture;
};

/** Load the globe pack and add water, snow and wind to the scene. Rejects if the pack is missing or invalid. */
export async function createLivingEarth(baseUrl: string, scene: Scene, mask: LandMask, s: TierSettings, maxTexture: number, reduced: boolean, probe = false): Promise<LivingEarth> {
  const pack = await loadPack(baseUrl, probe);
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

  const climatePx: MonthlyPixels = { data: pack.climatePixels, atlasWidth: pack.climate.width, month: manifest.climate.month, layout: manifest.layout };
  const surfacePx: MonthlyPixels | null = pack.surfacePixels
    ? { data: pack.surfacePixels, atlasWidth: manifest.surface.month[0] * manifest.layout.cols, month: manifest.surface.month, layout: manifest.layout }
    : null;
  const sc = (name: string) => channel(manifest.surface, name);
  const temp = channel(manifest.climate, 'temp');

  return {
    manifest,
    sample(lng, lat, t) {
      if (!surfacePx) return null;
      const reading: EnvReading = {
        windU: sampleValue(climatePx, 0, u, lng, lat, t), windV: sampleValue(climatePx, 1, v, lng, lat, t), tempC: sampleValue(climatePx, 2, temp, lng, lat, t),
        waterPct: sampleValue(surfacePx, 0, sc('water'), lng, lat, t), snowPct: sampleValue(surfacePx, 1, sc('snow'), lng, lat, t), ndvi: sampleValue(surfacePx, 2, sc('ndvi'), lng, lat, t),
      };
      return { reading, onLand: sampleMask(mask, lng, lat).land };
    },
    update(t, time, dt, ch, camera) {
      surface?.set(ch.water, ch.snow);
      surface?.update(t, time);
      wind.setOpacity(ch.wind);
      wind.update(t, dt, camera);
    },
    setTier(next) {
      surface?.setMaterialFx(next.materialFx && !reduced);
      wind.resize(next.windStreaks);
    },
    dispose() {
      if (surface) { scene.remove(surface.mesh); surface.dispose(); }
      scene.remove(wind.lines);
      wind.dispose();
    },
  };
}
