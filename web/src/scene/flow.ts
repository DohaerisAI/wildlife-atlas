/**
 * Species-level particle flow.
 *
 * Each particle stands for a share of the species' recorded presence, not an individual animal.
 * For every month we sample particle positions from the monthly distribution using a shared
 * quantile along a Hilbert curve, so a particle at quantile u in one month lands near the cells at
 * quantile u in the next. Interpolating between months gives coherent motion as the range shifts.
 */
import type { SpeciesRange } from '../types';
import { hilbertIndex, mulberry32 } from './rng';

const MONTHS = 12;
const HILBERT_N = 256;

export interface FlowField {
  readonly count: number;
  /** [month][particle*2] lng, lat */
  readonly positions: Float32Array[];
  /** 0..1 share of peak monthly mass */
  readonly mass: Float32Array;
  /** per-particle visibility threshold; visible when threshold < mass */
  readonly threshold: Float32Array;
  readonly phase: Float32Array;
}

interface WeightedCell { lat0: number; lng0: number; order: number; w: number[] }

function cellsOf(range: SpeciesRange): WeightedCell[] {
  return Object.entries(range.cells)
    .map(([id, c]) => {
      const [lat0, lng0] = id.split('_').map(Number) as [number, number];
      const x = Math.floor(((lng0 + 180) / 360) * HILBERT_N);
      const y = Math.floor(((lat0 + 90) / 180) * HILBERT_N);
      return { lat0, lng0, order: hilbertIndex(HILBERT_N, x, y), w: c.r };
    })
    .sort((a, b) => a.order - b.order);
}

function pickCell(cells: WeightedCell[], cdf: Float64Array, u: number): WeightedCell {
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((cdf[mid] ?? 0) < u) lo = mid + 1;
    else hi = mid;
  }
  return cells[lo]!;
}

export function buildFlow(range: SpeciesRange, cellSize: number, count: number, seed = 1): FlowField {
  const cells = cellsOf(range);
  const rand = mulberry32(seed);
  const jitter = Float32Array.from({ length: count * 2 }, () => rand());
  const threshold = Float32Array.from({ length: count }, () => rand());
  const phase = Float32Array.from({ length: count }, () => rand() * Math.PI * 2);
  const totals = Array.from({ length: MONTHS }, (_, m) => cells.reduce((s, c) => s + (c.w[m] ?? 0), 0));
  const peak = Math.max(...totals, 0);
  const mass = Float32Array.from(totals, (t) => (peak > 0 ? t / peak : 0));

  const sampled: (Float32Array | null)[] = totals.map((total, m) => {
    if (total <= 0 || cells.length === 0) return null;
    const cdf = new Float64Array(cells.length);
    let acc = 0;
    cells.forEach((c, i) => { acc += (c.w[m] ?? 0) / total; cdf[i] = acc; });
    const out = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const cell = pickCell(cells, cdf, (i + 0.5) / count);
      out[i * 2] = cell.lng0 + jitter[i * 2]! * cellSize;
      out[i * 2 + 1] = cell.lat0 + jitter[i * 2 + 1]! * cellSize;
    }
    return out;
  });

  return { count, positions: fillEmptyMonths(sampled, count), mass, threshold, phase };
}

/** Months with no presence reuse the nearest earlier month so particles fade in place, not fly to 0,0. */
function fillEmptyMonths(sampled: (Float32Array | null)[], count: number): Float32Array[] {
  const firstFull = sampled.findIndex((s) => s !== null);
  if (firstFull < 0) return sampled.map(() => new Float32Array(count * 2));
  const out: Float32Array[] = new Array(MONTHS);
  let last = sampled[firstFull]!;
  for (let k = 0; k < MONTHS; k++) {
    const m = (firstFull + k) % MONTHS;
    last = sampled[m] ?? last;
    out[m] = last;
  }
  return out;
}

export const easeInOut = (s: number) => (s < 0.5 ? 4 * s * s * s : 1 - (-2 * s + 2) ** 3 / 2);

/**
 * Monthly data describes the middle of each month, so month m (0-based) is anchored at t = m + 0.5.
 * Returns the two surrounding anchor months and the eased blend between them.
 */
export function monthBlend(t: number): { m0: number; m1: number; s: number } {
  const shifted = ((((t - 0.5) % MONTHS) + MONTHS) % MONTHS);
  const m0 = Math.floor(shifted);
  return { m0, m1: (m0 + 1) % MONTHS, s: easeInOut(shifted - m0) };
}

/** Species' presence at time t as a share of its peak month. */
export function massAt(flow: FlowField, t: number): number {
  const { m0, m1, s } = monthBlend(t);
  return flow.mass[m0]! * (1 - s) + flow.mass[m1]! * s;
}

/**
 * Write particle state at fractional time t (0 ≤ t < 12, 0 = start of January, 0.5 = mid-January) into out as
 * [lng, lat, alpha] triples. Returns out for chaining.
 */
export function sampleFlow(flow: FlowField, t: number, out: Float32Array, wobbleDeg = 0.25): Float32Array {
  const tt = ((t % MONTHS) + MONTHS) % MONTHS;
  const { m0, m1, s } = monthBlend(t);
  const a = flow.positions[m0]!;
  const b = flow.positions[m1]!;
  const massNow = massAt(flow, t);
  for (let i = 0; i < flow.count; i++) {
    const ph = flow.phase[i]!;
    const wob = Math.sin(tt * 6 + ph) * wobbleDeg;
    out[i * 3] = a[i * 2]! + (b[i * 2]! - a[i * 2]!) * s + wob;
    out[i * 3 + 1] = a[i * 2 + 1]! + (b[i * 2 + 1]! - a[i * 2 + 1]!) * s + Math.cos(tt * 5 + ph) * wobbleDeg;
    const edge = (massNow - flow.threshold[i]!) * 12;
    out[i * 3 + 2] = Math.min(1, Math.max(0, edge));
  }
  return out;
}

/** Per-cell presence at fractional time t, normalized to the species' peak rate. */
export function cellIntensity(range: SpeciesRange, t: number, peak: number): Map<string, number> {
  const { m0, m1, s } = monthBlend(t);
  const out = new Map<string, number>();
  const p = peak || 1;
  for (const [id, c] of Object.entries(range.cells)) {
    out.set(id, (((c.r[m0] ?? 0) * (1 - s) + (c.r[m1] ?? 0) * s) / p));
  }
  return out;
}
