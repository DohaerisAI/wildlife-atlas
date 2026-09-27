import { Vector3 } from 'three';

const DEG = Math.PI / 180;
export const EARTH_KM = 6371;

/** Unit-sphere convention: +Y is north, lng 0 faces +X... rotated so lng 0 sits on -Z like three-globe. */
export function lngLatToVec3(lng: number, lat: number, radius: number, out = new Vector3()): Vector3 {
  const phi = (90 - lat) * DEG;
  const theta = (lng + 180) * DEG;
  return out.set(-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta));
}

export function vec3ToLngLat(v: Vector3): { lng: number; lat: number } {
  const r = v.length();
  const lat = 90 - Math.acos(v.y / r) / DEG;
  let lng = Math.atan2(v.z, -v.x) / DEG - 180;
  if (lng < -180) lng += 360;
  return { lng, lat };
}
