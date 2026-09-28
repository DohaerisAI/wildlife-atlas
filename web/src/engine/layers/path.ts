/** Great-circle polylines on the unit sphere, parameterised by distance (0..1). Pure, testable. */
const DEG = Math.PI / 180;
export const EARTH_RADIUS_KM = 6371;

type V3 = [number, number, number];
const toV = (lng: number, lat: number): V3 => [Math.cos(lat * DEG) * Math.cos(lng * DEG), Math.cos(lat * DEG) * Math.sin(lng * DEG), Math.sin(lat * DEG)];
const toLL = (v: V3): [number, number] => [Math.atan2(v[1], v[0]) / DEG, Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG];
const angle = (a: V3, b: V3) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

function slerp(a: V3, b: V3, t: number): V3 {
  const w = angle(a, b);
  if (w < 1e-9) return a;
  const s = Math.sin(w), k1 = Math.sin((1 - t) * w) / s, k2 = Math.sin(t * w) / s;
  return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
}

export interface GeoPath {
  readonly km: number;
  at(u: number): [number, number];
  /** fraction of total distance at which waypoint `i` sits */
  fractionAt(i: number): number;
}

export function geoPath(waypoints: readonly (readonly [number, number])[]): GeoPath {
  if (waypoints.length < 2) throw new Error('A path needs at least two waypoints');
  const vs = waypoints.map(([lng, lat]) => toV(lng, lat));
  const seg = vs.slice(1).map((v, i) => angle(vs[i]!, v));
  const total = seg.reduce((a, b) => a + b, 0);
  const cum = seg.reduce<number[]>((acc, s) => [...acc, acc[acc.length - 1]! + s], [0]);
  return {
    km: total * EARTH_RADIUS_KM,
    fractionAt: (i) => (total ? cum[Math.max(0, Math.min(cum.length - 1, i))]! / total : 0),
    at(u) {
      let x = Math.max(0, Math.min(1, u)) * total;
      for (let i = 0; i < seg.length; i++) {
        if (x <= seg[i]! || i === seg.length - 1) return toLL(slerp(vs[i]!, vs[i + 1]!, seg[i] ? Math.min(1, x / seg[i]!) : 0));
        x -= seg[i]!;
      }
      return [waypoints[waypoints.length - 1]![0], waypoints[waypoints.length - 1]![1]];
    },
  };
}
