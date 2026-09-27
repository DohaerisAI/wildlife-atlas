import { PRESENCE_ORDER } from './constants';
import type { CellDetail, Month, Presence } from './types';

export interface ListedSpecies {
  key: string;
  presence: Presence;
  records: number;
  share: number;
}

export type GroupedList = { presence: Presence; species: ListedSpecies[] }[];

/**
 * Species to show for a cell in a month: residents and uncertain species with records,
 * seasonal and passage species only in months the pipeline marked as present.
 */
export function wildlifeHere(cell: CellDetail, month: Month): GroupedList {
  const i = month - 1;
  const total = cell.total[i] ?? 0;
  const listed = cell.species
    .filter((s) => (s.c[i] ?? 0) > 0)
    .filter((s) => s.p === 'resident' || s.p === 'uncertain' || s.m[i] === 1)
    .map((s) => ({ key: s.k, presence: s.p, records: s.c[i] ?? 0, share: total > 0 ? (s.c[i] ?? 0) / total : 0 }));

  return PRESENCE_ORDER.map((presence) => ({
    presence,
    species: listed.filter((s) => s.presence === presence).sort((a, b) => b.share - a.share),
  })).filter((g) => g.species.length > 0);
}

/** Months (1..12) with any records for a species in a cell, for the 12-month strip. */
export function monthlyShares(counts: number[], totals: number[]): number[] {
  return counts.map((c, i) => {
    const t = totals[i] ?? 0;
    return t > 0 ? c / t : 0;
  });
}

/** Normalize a species' monthly rates to 0..1 against its peak across all cells. */
export function peakRate(range: Record<string, { r: number[] }>): number {
  let peak = 0;
  for (const cell of Object.values(range)) for (const r of cell.r) peak = Math.max(peak, r);
  return peak;
}

/** How many cells a species is present in for each month, for the profile strip. */
export function cellsPerMonth(range: Record<string, { r: number[] }>): number[] {
  const out = new Array<number>(12).fill(0);
  for (const cell of Object.values(range)) cell.r.forEach((r, i) => { if (r > 0) out[i] = (out[i] ?? 0) + 1; });
  return out;
}
