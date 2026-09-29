import { WIND, type StreakScale } from './motion';
import { decodeByte, monthBlend, tileOf, type PackChannel, type PackLayout } from './pack';

/** ERA5 monthly 10 m wind as RGBA atlas pixels (R = u east, G = v north), sampled on the CPU. */
export interface WindField {
  readonly data: Uint8ClampedArray;
  readonly atlasWidth: number;
  readonly month: readonly [number, number];
  readonly layout: Pick<PackLayout, 'cols' | 'rows'>;
  readonly u: Pick<PackChannel, 'lo' | 'hi'>;
  readonly v: Pick<PackChannel, 'lo' | 'hi'>;
}

const DEG = Math.PI / 180;

/** Bilinear u, v (m/s) for one month; pixel centres sit half a cell in from the edges. */
function sampleMonth(f: WindField, month: number, lng: number, lat: number): [number, number] {
  const [w, h] = f.month;
  const [col, row] = tileOf(month, f.layout);
  const fx = ((lng + 180) / 360) * w - 0.5;
  const fy = Math.min(h - 1, Math.max(0, ((90 - lat) / 180) * h - 0.5));
  const x0 = Math.floor(fx); const y0 = Math.floor(fy);
  const tx = fx - x0; const ty = fy - y0;
  const px = (x: number, y: number) => ((row * h + Math.min(h - 1, y)) * f.atlasWidth + col * w + (((x % w) + w) % w)) * 4;
  const c = [px(x0, y0), px(x0 + 1, y0), px(x0, y0 + 1), px(x0 + 1, y0 + 1)] as const;
  const lerp = (o: number) => {
    const d = f.data;
    const top = d[c[0] + o]! * (1 - tx) + d[c[1] + o]! * tx;
    const bottom = d[c[2] + o]! * (1 - tx) + d[c[3] + o]! * tx;
    return top * (1 - ty) + bottom * ty;
  };
  return [decodeByte(lerp(0), f.u), decodeByte(lerp(1), f.v)];
}

/** Wind (m/s east, m/s north) at a place and a fractional month (0.5 = mid-January). */
export function sampleWind(f: WindField, lng: number, lat: number, t: number): [number, number] {
  const { m0, m1, w } = monthBlend(t);
  const a = sampleMonth(f, m0, lng, lat);
  if (w === 0) return a;
  const b = sampleMonth(f, m1, lng, lat);
  return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
}

/** Degrees per second of screen motion for a wind speed component. */
export function windRate(ms: number, scale: StreakScale = WIND): number {
  return (ms / scale.maxMs) * scale.cellsPerS * scale.cellDeg;
}

/** Move a point with the wind for `dt` seconds. */
export function advect(lng: number, lat: number, u: number, v: number, dt: number, scale: StreakScale = WIND): [number, number] {
  const cosLat = Math.max(0.2, Math.cos(lat * DEG));
  const nextLat = Math.max(-89.5, Math.min(89.5, lat + windRate(v, scale) * dt));
  let nextLng = lng + (windRate(u, scale) * dt) / cosLat;
  if (nextLng > 180) nextLng -= 360;
  if (nextLng < -180) nextLng += 360;
  return [nextLng, nextLat];
}

/** A point spread evenly over the spherical cap of angular radius `radius` around a centre. */
export function capPoint(lng0: number, lat0: number, radius: number, r1: number, r2: number): [number, number] {
  const cosD = 1 - r1 * (1 - Math.cos(radius));
  const d = Math.acos(cosD);
  const bearing = r2 * 2 * Math.PI;
  const p0 = lat0 * DEG;
  const lat = Math.asin(Math.sin(p0) * cosD + Math.cos(p0) * Math.sin(d) * Math.cos(bearing));
  const lng = lng0 * DEG + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(p0), cosD - Math.sin(p0) * Math.sin(lat));
  return [((((lng / DEG) + 540) % 360) - 180), lat / DEG];
}
