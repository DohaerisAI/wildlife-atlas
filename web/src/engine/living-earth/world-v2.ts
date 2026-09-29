import { Color, LinearFilter, NearestFilter, PerspectiveCamera, Scene, Texture } from 'three';
import type { TierSettings } from '../core/tiers';
import type { Globe } from '../globe/globe';
import type { LandMask } from '../globe/mask';
import { sampleMask } from '../globe/mask';
import { LAYER_ORDER } from '../layers/order';
import { CURRENT } from './motion';
import { OceanLayer } from './ocean-layer';
import { decodeByte, monthBlend, tileOf } from './pack';
import { currentsForSampler, decodeElevation, decodeFlagged, ELEVATION_LO, type LoadedPackV2 } from './pack-v2';
import type { EnvReadingV2 } from './reading';
import { atMonth, subsolarPoint } from './sun';
import { WindLayer } from './wind-layer';

export interface WorldChannels { readonly land: number; readonly currents: number; readonly blooms: number; readonly lights: number; readonly depth: number }

export interface WorldV2 {
  update(t: number, dt: number, ch: WorldChannels, camera: PerspectiveCamera): void;
  sample(lng: number, lat: number, t: number): EnvReadingV2 | null;
  setTier(s: TierSettings): void;
  dispose(): void;
}

const CURRENT_COLOR = new Color('#62d6f2');

function dataTexture(img: ImageBitmap, nearest = false): Texture {
  const t = new Texture(img);
  t.flipY = false;
  t.generateMipmaps = false;
  t.minFilter = nearest ? NearestFilter : LinearFilter;
  t.magFilter = nearest ? NearestFilter : LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Static single-frame layer read at a place (nearest pixel). */
function staticByte(px: Uint8ClampedArray, w: number, h: number, lng: number, lat: number, c: number): number {
  const x = Math.min(w - 1, Math.max(0, Math.floor(((lng + 180) / 360) * w)));
  const y = Math.min(h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * h)));
  return px[(y * w + x) * 4 + c]!;
}

/**
 * Everything pack v2 adds: land dots coloured by class and greenness, relief light, ocean shelves,
 * plankton blooms, city lights at night and surface currents as streaks.
 */
export function attachWorldV2(pack: LoadedPackV2, surfaceTexture: Texture, scene: Scene, globe: Globe | null, mask: LandMask, s: TierSettings, reduced: boolean): WorldV2 {
  const m = pack.manifest;
  const land = dataTexture(pack.land, true);
  const relief = dataTexture(pack.relief);
  const oceanTex = dataTexture(pack.ocean);
  const [sw, sh] = m.surface.month;
  const [ow, oh] = m.ocean.month;
  const ndvi = m.surface.channels[2]!;
  const landMaterials = { land, surface: surfaceTexture, grid: [m.layout.cols, m.layout.rows] as const, half: [0.5 / sw, 0.5 / sh] as const, ndvi: { lo: ndvi.lo, hi: ndvi.hi } };
  let landOn = false;

  const ocean = new OceanLayer({ ocean: oceanTex, relief, grid: [m.layout.cols, m.layout.rows], half: [0.5 / ow, 0.5 / oh], layout: m.layout, elevLo: ELEVATION_LO });
  scene.add(ocean.mesh);

  const [cu, cv] = [m.ocean.channels[0]!, m.ocean.channels[1]!];
  const oceanAtlasW = pack.ocean.width;
  const currents = new WindLayer(
    { data: currentsForSampler(pack.oceanPixels), atlasWidth: oceanAtlasW, month: m.ocean.month, layout: m.layout, u: cu, v: cv },
    Math.round(s.windStreaks * 0.8), reduced,
    { scale: CURRENT, color: CURRENT_COLOR, radius: 1.0022, order: LAYER_ORDER.ocean + 0.5, gain: 0.42, where: (lng, lat) => !sampleMask(mask, lng, lat).land },
  );
  scene.add(currents.lines);
  // the GPU keeps the atlas; free the decoded bitmap only after it is uploaded
  oceanTex.onUpdate = () => pack.ocean.close();

  const [lw, lh] = m.land.size;
  const [rw, rh] = m.relief.size;
  const [chl, lightsCh, treeCh] = [m.ocean.channels[2]!, m.relief.channels[1]!, m.land.channels[1]!];

  return {
    update(t, dt, ch, camera) {
      const { m0, m1, w } = monthBlend(t);
      const wantLand = ch.land > 0.01;
      if (wantLand !== landOn) { landOn = wantLand; globe?.setLandMaterials(landOn ? landMaterials : null); }
      globe?.setSurfaceMonth(tileOf(m0, m.layout), tileOf(m1, m.layout), w);
      const sun = subsolarPoint(atMonth(new Date(), t));
      ocean.set({ depth: ch.depth, bloom: ch.blooms, lights: ch.lights });
      ocean.update(t, sun.lng, sun.lat);
      currents.setOpacity(ch.currents);
      currents.update(t, dt, camera);
    },
    sample(lng, lat, t) {
      if (!pack.landPixels || !pack.reliefPixels) return null;
      // nearest pixel: ocean bytes carry a no-data flag that must not be blended with real values
      const ow2 = m.ocean.month[0]; const oh2 = m.ocean.month[1];
      const blend = monthBlend(t);
      const [col, row] = tileOf(blend.w >= 0.5 ? blend.m1 : blend.m0, m.layout);
      const x = Math.min(ow2 - 1, Math.max(0, Math.floor(((lng + 180) / 360) * ow2)));
      const y = Math.min(oh2 - 1, Math.max(0, Math.floor(((90 - lat) / 180) * oh2)));
      const flagged = (c: number, ch2: typeof cu) => decodeFlagged(pack.oceanPixels[((row * oh2 + y) * oceanAtlasW + col * ow2 + x) * 4 + c]!, ch2);
      const lightsB = staticByte(pack.reliefPixels, rw, rh, lng, lat, 2);
      return {
        landClass: staticByte(pack.landPixels, lw, lh, lng, lat, 0),
        treePct: decodeByte(staticByte(pack.landPixels, lw, lh, lng, lat, 1), treeCh),
        elevationM: decodeElevation(staticByte(pack.reliefPixels, rw, rh, lng, lat, 0), staticByte(pack.reliefPixels, rw, rh, lng, lat, 1)),
        lightsLog: lightsCh.lo + (lightsB / 255) * (lightsCh.hi - lightsCh.lo),
        currentU: flagged(0, cu), currentV: flagged(1, cv),
        chlLog: flagged(2, chl),
      };
    },
    setTier(next) { currents.resize(Math.round(next.windStreaks * 0.8)); },
    dispose() {
      scene.remove(ocean.mesh, currents.lines);
      ocean.dispose(); currents.dispose();
      land.dispose(); relief.dispose(); oceanTex.dispose();
      globe?.setLandMaterials(null);
    },
  };
}
