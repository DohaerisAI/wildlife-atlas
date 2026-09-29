import { PRESENCE_ORDER } from '../constants';
import type { CellDetail, CellSpecies, Month, Presence } from '../types';

export type Doing = 'arriving' | 'leaving' | 'staying' | 'passing' | 'resident' | 'recorded';

export interface PlaceRow {
  readonly key: string;
  readonly presence: Presence;
  readonly doing: Doing;
  /** share of this month's records here */
  readonly share: number;
  /** share of records per month, Jan..Dec, for the 12-month strip */
  readonly months: readonly number[];
}

export interface PlaceGroup { readonly presence: Presence; readonly rows: readonly PlaceRow[] }

export interface PlaceSummary {
  readonly groups: readonly PlaceGroup[];
  readonly total: number;
  /** species present in each month (Jan..Dec), for the place's own seasonal chart */
  readonly richness: readonly number[];
  /** how many are moving (arriving, leaving, passing) this month */
  readonly moving: number;
}

function doingOf(s: CellSpecies, i: number): Doing {
  if (s.p === 'resident') return 'resident';
  if (s.p === 'passage') return 'passing';
  if (s.p === 'uncertain') return 'recorded';
  if (s.m[(i + 11) % 12] !== 1) return 'arriving';
  if (s.m[(i + 1) % 12] !== 1) return 'leaving';
  return 'staying';
}

/** Spec 3.1: residents and uncertain species with records; seasonal and passage only in marked months. */
const listedIn = (s: CellSpecies, i: number) =>
  (s.c[i] ?? 0) > 0 && (s.p === 'resident' || s.p === 'uncertain' || s.m[i] === 1);

export function placeSummary(cell: CellDetail, month: Month): PlaceSummary {
  const i = month - 1;
  const totalAt = (j: number) => cell.total[j] ?? 0;
  const rows = cell.species.filter((s) => listedIn(s, i)).map((s): PlaceRow => ({
    key: s.k,
    presence: s.p,
    doing: doingOf(s, i),
    share: totalAt(i) > 0 ? (s.c[i] ?? 0) / totalAt(i) : 0,
    months: s.c.map((c, j) => (totalAt(j) > 0 ? c / totalAt(j) : 0)),
  }));
  const groups = PRESENCE_ORDER
    .map((presence) => ({ presence, rows: rows.filter((r) => r.presence === presence).sort((a, b) => b.share - a.share) }))
    .filter((g) => g.rows.length > 0);
  const richness = Array.from({ length: 12 }, (_, j) => cell.species.filter((s) => listedIn(s, j)).length);
  const moving = rows.filter((r) => r.doing === 'arriving' || r.doing === 'leaving' || r.doing === 'passing').length;
  return { groups, total: rows.length, richness, moving };
}
