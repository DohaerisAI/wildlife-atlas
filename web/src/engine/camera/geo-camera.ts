import { EARTH_KM } from '../globe/geo';

/** Space-to-town camera maths (decision 0010): altitude in km over a point, zoom and pan scaled by altitude. */
export interface GeoPose { readonly lng: number; readonly lat: number; readonly altKm: number }

/** absolute floor: the finest tiles anywhere (level 11, ~75 m Sentinel-2 at sites) */
export const MIN_ALT_KM = 25;
/** floor over level-8 data (~300 m, MODIS colour ~500 m); each finer level present halves it, down to MIN_ALT_KM */
export const DATA_FLOOR_KM = 200;

/** How close the camera may come over data whose finest tile level is `level`: closer only blurs. */
export function floorForLevel(level: number): number {
  return Math.max(MIN_ALT_KM, DATA_FLOOR_KM / 2 ** Math.max(0, level - 8));
}
export const MAX_ALT_KM = 25000;
const MAX_LAT = 85;

export const wrapLng = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
export const clampAlt = (a: number): number => Math.min(MAX_ALT_KM, Math.max(MIN_ALT_KM, a));
export const clampLat = (l: number): number => Math.min(MAX_LAT, Math.max(-MAX_LAT, l));

/** Wheel zoom: each notch is the same ratio of altitude at every scale (100 px of wheel = x0.86 or x1.16). */
export function zoomBy(altKm: number, wheelDelta: number, rate = 0.0015): number {
  return clampAlt(altKm * Math.exp(wheelDelta * rate));
}

/** Degrees of ground per screen pixel under the camera; capped so one screen-wide drag turns at most ~half the globe. */
export function degreesPerPixel(altKm: number, fovYRad: number, heightPx: number): number {
  const km = (2 * altKm * Math.tan(fovYRad / 2)) / heightPx;
  return Math.min(km / 111.32, 120 / heightPx);
}

/** Drag the ground under the pointer: dx/dy in px move the camera the other way. */
export function panBy(p: GeoPose, dxPx: number, dyPx: number, fovYRad: number, heightPx: number): GeoPose {
  const dpp = degreesPerPixel(p.altKm, fovYRad, heightPx);
  const lat = clampLat(p.lat + dyPx * dpp);
  const cos = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  return { lng: wrapLng(p.lng - (dxPx * dpp) / cos), lat, altKm: p.altKm };
}

/**
 * Near and far planes that hug what can be seen: near a fraction of the altitude (nothing is closer than the
 * ground), far just past the horizon, or past the atmosphere shell when the whole globe is in view.
 */
export function clipPlanes(altKm: number): { near: number; far: number } {
  const h = altKm / EARTH_KM;
  const d = 1 + h;
  const horizon = Math.sqrt(d * d - 1);
  return { near: Math.max(1e-6, h * 0.35), far: Math.min(d + 1.2, horizon * 1.6 + 0.25) };
}

const smooth = (k: number) => k * k * (3 - 2 * k);

/**
 * One continuous flight: position eases the short way round, altitude moves in log space and, for long hops,
 * rises first so the ground never streaks past close up (the crane shot of atlas/globe.ts, in altitude terms).
 */
export function flightPose(from: GeoPose, to: GeoPose, k: number): GeoPose {
  const e = smooth(Math.min(1, Math.max(0, k)));
  const dLng = wrapLng(to.lng - from.lng);
  const hop = Math.hypot(dLng * Math.cos(((from.lat + to.lat) * Math.PI) / 360), to.lat - from.lat) * 111.32;
  const peak = Math.max(from.altKm, to.altKm, hop * 1.2);
  const la = Math.log(from.altKm); const lb = Math.log(to.altKm);
  // log altitude eases from start to end, plus a hump up to the peak for long hops
  const hump = Math.max(0, Math.log(peak) - Math.max(la, lb));
  const logAlt = la + (lb - la) * e + hump * 4 * e * (1 - e);
  // position leads early when climbing out and lags when descending in, so we look at the target while falling
  const pe = smooth(Math.min(1, e * 1.25));
  return { lng: wrapLng(from.lng + dLng * pe), lat: from.lat + (to.lat - from.lat) * pe, altKm: clampAlt(Math.exp(logAlt)) };
}

/** Rotate less per pixel close in and damp inertia faster, so nothing feels jumpy at town scale. */
export const inertiaDecay = (altKm: number): number => (altKm < 50 ? 8 : altKm < 1000 ? 5 : 3.5);

/**
 * Keep the ground under the cursor under the cursor while zooming: when altitude scales by `ratio`
 * (new / old), the view centre moves toward (zoom in) or away from (zoom out) the anchor by 1 - ratio.
 */
export function zoomToward(p: GeoPose, anchor: { lng: number; lat: number }, ratio: number): GeoPose {
  const k = 1 - ratio;
  const dLng = wrapLng(anchor.lng - p.lng);
  return { lng: wrapLng(p.lng + dLng * k), lat: clampLat(p.lat + (anchor.lat - p.lat) * k), altKm: p.altKm };
}
