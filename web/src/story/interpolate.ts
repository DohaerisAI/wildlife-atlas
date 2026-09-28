import type { Chapter, Counter, Story } from './schema';

export interface StoryState {
  readonly lng: number;
  readonly lat: number;
  readonly altKm: number;
  readonly frameX: number;
  readonly month: number;
  readonly channels: Readonly<Record<string, number>>;
  /** index of the chapter whose text is on screen */
  readonly chapter: number;
  /** 0..1 progress from this chapter's keyframe to the next */
  readonly local: number;
}

const DEG = Math.PI / 180;
export const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const wrap12 = (m: number) => ((m % 12) + 12) % 12;

/** Shortest way round the year: Nov → Jan goes forward two months, not back ten. */
export function lerpMonth(a: number, b: number, u: number): number {
  let d = wrap12(b) - wrap12(a);
  if (d > 6) d -= 12;
  if (d < -6) d += 12;
  return wrap12(a + d * u);
}

function slerpLngLat(a: Chapter['camera'], b: Chapter['camera'], u: number): { lng: number; lat: number; arc: number } {
  const va = [Math.cos(a.lat * DEG) * Math.cos(a.lng * DEG), Math.cos(a.lat * DEG) * Math.sin(a.lng * DEG), Math.sin(a.lat * DEG)];
  const vb = [Math.cos(b.lat * DEG) * Math.cos(b.lng * DEG), Math.cos(b.lat * DEG) * Math.sin(b.lng * DEG), Math.sin(b.lat * DEG)];
  const dot = Math.max(-1, Math.min(1, va[0]! * vb[0]! + va[1]! * vb[1]! + va[2]! * vb[2]!));
  const w = Math.acos(dot);
  if (w < 1e-6) return { lng: a.lng, lat: a.lat, arc: 0 };
  const s = Math.sin(w), k1 = Math.sin((1 - u) * w) / s, k2 = Math.sin(u * w) / s;
  const v = [va[0]! * k1 + vb[0]! * k2, va[1]! * k1 + vb[1]! * k2, va[2]! * k1 + vb[2]! * k2];
  return { lng: Math.atan2(v[1]!, v[0]!) / DEG, lat: Math.asin(Math.max(-1, Math.min(1, v[2]!))) / DEG, arc: w };
}

/**
 * State at scroll position `s` (0 = first chapter, n-1 = last). Camera flies along the great circle
 * with a crane-shot rise mid-flight proportional to the distance travelled.
 */
export function stateAt(story: Story, s: number): StoryState {
  const n = story.chapters.length;
  const pos = Math.max(0, Math.min(n - 1, s));
  const i = Math.min(n - 2, Math.floor(pos));
  const local = pos - i;
  const u = easeInOut(local);
  const a = story.chapters[i]!, b = story.chapters[i + 1]!;
  const g = slerpLngLat(a.camera, b.camera, u);
  const logAlt = Math.log(a.camera.altKm) + (Math.log(b.camera.altKm) - Math.log(a.camera.altKm)) * u;
  const rise = 1 + Math.sin(Math.PI * u) * Math.min(1.2, g.arc * 1.6);
  const channels: Record<string, number> = {};
  for (const k of Object.keys(a.channels)) channels[k] = a.channels[k]! + ((b.channels[k] ?? a.channels[k]!) - a.channels[k]!) * u;
  return {
    lng: g.lng, lat: g.lat, altKm: Math.exp(logAlt) * rise,
    frameX: a.camera.frameX + (b.camera.frameX - a.camera.frameX) * u,
    month: lerpMonth(a.month, b.month, u), channels,
    chapter: local > 0.5 && i + 1 < n ? i + 1 : i, local,
  };
}

export function counterValue(c: Counter, channels: Readonly<Record<string, number>>): number {
  const v = channels[c.channel] ?? 0;
  const [d0, d1] = c.domain;
  const k = d1 === d0 ? 0 : Math.max(0, Math.min(1, (v - d0) / (d1 - d0)));
  return c.range[0] + (c.range[1] - c.range[0]) * k;
}
