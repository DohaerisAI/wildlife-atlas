/** Place labels: who may show at an altitude, in what order, and screen-space collision (decision 0010). */
export interface Place {
  readonly name: string;
  readonly lng: number;
  readonly lat: number;
  readonly population: number;
  /** 0 national capital, 1 first-order admin seat, 2 other */
  readonly kind: number;
  readonly admin1: string;
  readonly country: string;
}

/** (altitude km, smallest population shown), log-interpolated between rows. */
const THRESHOLDS: readonly (readonly [number, number])[] = [
  [20000, 4_000_000], [6000, 1_500_000], [2500, 400_000], [1000, 120_000], [400, 30_000], [150, 8_000], [50, 2_500], [15, 1_000],
];

export function minPopulation(altKm: number): number {
  if (altKm >= THRESHOLDS[0]![0]) return THRESHOLDS[0]![1];
  for (let i = 1; i < THRESHOLDS.length; i++) {
    const [a1, p1] = THRESHOLDS[i]!;
    const [a0, p0] = THRESHOLDS[i - 1]!;
    if (altKm >= a1) {
      const k = Math.log(altKm / a1) / Math.log(a0 / a1);
      return Math.exp(Math.log(p1) + (Math.log(p0) - Math.log(p1)) * k);
    }
  }
  return THRESHOLDS[THRESHOLDS.length - 1]![1];
}

/** Capitals and admin seats may show at a fifth / half of the population the altitude asks for. */
export function eligible(p: Place, altKm: number): boolean {
  const scale = p.kind === 0 ? 0.2 : p.kind === 1 ? 0.5 : 1;
  return p.population >= minPopulation(altKm) * scale;
}

export const priority = (p: Place): number => Math.log10(Math.max(1, p.population)) + (p.kind === 0 ? 1.2 : p.kind === 1 ? 0.4 : 0);

export type LabelSize = 'l' | 'm' | 's';
export function labelSize(p: Place, altKm: number): LabelSize {
  const ratio = p.population / minPopulation(altKm);
  return ratio > 20 || p.kind === 0 ? 'l' : ratio > 4 ? 'm' : 's';
}
export const FONT_PX: Readonly<Record<LabelSize, number>> = { l: 15, m: 13, s: 11.5 };

/** Label box in px from the text: an estimate good enough for collision (serif, ~0.56 em per character). */
export function boxSize(name: string, size: LabelSize): { w: number; h: number } {
  const px = FONT_PX[size];
  return { w: Math.ceil(name.length * px * 0.56) + 10, h: Math.ceil(px * 1.3) + 4 };
}

export interface Candidate { readonly id: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly priority: number }

/**
 * Greedy placement: highest priority first, a label is kept only if its box (centred on x, y) overlaps no kept box.
 * A coarse grid keeps it near-linear. Returns the ids placed, at most `max`.
 */
export function placeLabels(cands: readonly Candidate[], max: number, cell = 96): Set<string> {
  const order = [...cands].sort((a, b) => b.priority - a.priority);
  const grid = new Map<string, Candidate[]>();
  const placed = new Set<string>();
  const cellsOf = (c: Candidate) => {
    const out: string[] = [];
    for (let gx = Math.floor((c.x - c.w / 2) / cell); gx <= Math.floor((c.x + c.w / 2) / cell); gx++) {
      for (let gy = Math.floor((c.y - c.h / 2) / cell); gy <= Math.floor((c.y + c.h / 2) / cell); gy++) out.push(`${gx},${gy}`);
    }
    return out;
  };
  const hits = (a: Candidate, b: Candidate) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
  for (const c of order) {
    if (placed.size >= max) break;
    const cells = cellsOf(c);
    if (cells.some((k) => grid.get(k)?.some((o) => hits(c, o)))) continue;
    cells.forEach((k) => { const list = grid.get(k); if (list) list.push(c); else grid.set(k, [c]); });
    placed.add(c.id);
  }
  return placed;
}

/** Fade toward a target opacity; frame-rate independent (~0.25 s). */
export const fade = (current: number, target: number, dt: number, rate = 9): number => current + (target - current) * (1 - Math.exp(-rate * dt));

export function parseRows(rows: unknown): Place[] {
  if (!Array.isArray(rows)) throw new TypeError('places file must be an array of rows');
  return rows.flatMap((r) => {
    if (!Array.isArray(r) || typeof r[0] !== 'string' || typeof r[1] !== 'number' || typeof r[2] !== 'number') return [];
    return [{ name: r[0], lng: r[1], lat: r[2], population: Number(r[3]) || 0, kind: Number.isFinite(r[4]) ? Number(r[4]) : 2, admin1: String(r[5] ?? ''), country: String(r[6] ?? '') }];
  });
}
