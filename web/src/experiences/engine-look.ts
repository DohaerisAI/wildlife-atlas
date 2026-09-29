import type { MaterialChannels } from '../engine/living-earth/materials';

/**
 * How the one engine changes with altitude (decision 0010): the hologram dot globe from space, a continuous
 * tiled surface close in. Globe-scale Living Earth layers (wind, currents, water and snow at ~35 km pixels)
 * fade out before they would blur over the sharper tiles.
 */
export interface ZoomLook {
  readonly tileAlpha: number;
  readonly dotAlpha: number;
  readonly channels: MaterialChannels;
}

/** 0 at or above `hi` km, 1 at or below `lo` km, smooth in log altitude between. */
export function closeness(altKm: number, lo: number, hi: number): number {
  const k = (Math.log(hi) - Math.log(Math.max(1e-6, altKm))) / (Math.log(hi) - Math.log(lo));
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
}

export function zoomLook(altKm: number): ZoomLook {
  const near = closeness(altKm, 2500, 12000);
  const dotsGone = closeness(altKm, 1200, 6000);
  const globeLayersGone = closeness(altKm, 400, 2500);
  return {
    tileAlpha: 0.3 + 0.7 * near,
    dotAlpha: 1 - dotsGone,
    channels: {
      water: 0.8 * (1 - globeLayersGone), snow: 0.8 * (1 - globeLayersGone), wind: 0.6 * (1 - globeLayersGone),
      land: 1, currents: 0.5 * (1 - globeLayersGone), blooms: 0, lights: 0, depth: 1 - closeness(altKm, 150, 1500),
    },
  };
}
