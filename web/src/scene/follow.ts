/**
 * Follow camera: find where the visible flock is, so the camera can glide after it through the year.
 * Works on the sphere (averages unit vectors), so flocks straddling the antimeridian stay correct.
 */
import { sampleFlow, type FlowField } from './flow';

const DEG = Math.PI / 180;
const SAMPLE = 600;

export interface Vec3 { x: number; y: number; z: number }

export const toVec = (lng: number, lat: number): Vec3 => ({
  x: Math.cos(lat * DEG) * Math.cos(lng * DEG),
  y: Math.cos(lat * DEG) * Math.sin(lng * DEG),
  z: Math.sin(lat * DEG),
});

export function toLngLat(v: Vec3): { lng: number; lat: number } {
  const r = Math.hypot(v.x, v.y, v.z) || 1;
  return { lng: Math.atan2(v.y, v.x) / DEG, lat: Math.asin(v.z / r) / DEG };
}

/** Alpha-weighted centre of the flock at time t, or null when nothing is visible. */
export function flockCenter(flow: FlowField, t: number, scratch = new Float32Array(flow.count * 3)): Vec3 | null {
  sampleFlow(flow, t, scratch, 0);
  const step = Math.max(1, Math.floor(flow.count / SAMPLE));
  let x = 0, y = 0, z = 0, w = 0;
  for (let i = 0; i < flow.count; i += step) {
    const a = scratch[i * 3 + 2]!;
    if (a <= 0.02) continue;
    const v = toVec(scratch[i * 3]!, scratch[i * 3 + 1]!);
    x += v.x * a; y += v.y * a; z += v.z * a; w += a;
  }
  if (w === 0) return null;
  const len = Math.hypot(x, y, z);
  return len < 1e-6 ? null : { x: x / len, y: y / len, z: z / len };
}

/** Frame-rate independent glide of `current` toward `target` (both unit vectors). */
export function glide(current: Vec3, target: Vec3, dtSeconds: number, rate = 1.2): Vec3 {
  const k = 1 - Math.exp(-rate * dtSeconds);
  const v = { x: current.x + (target.x - current.x) * k, y: current.y + (target.y - current.y) * k, z: current.z + (target.z - current.z) * k };
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
