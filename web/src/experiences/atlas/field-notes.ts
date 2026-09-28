import { wildlifeHere } from '../../listing';
import type { CellDetail, CellSpecies, Month } from '../../types';

export type NoteStatus = 'arriving' | 'leaving' | 'visiting' | 'passing' | 'resident' | 'recorded';

export interface NoteRow { readonly key: string; readonly status: NoteStatus; readonly share: number }
export interface FieldNotes { readonly rows: readonly NoteRow[]; readonly total: number }

const DEFAULT_ROWS = 6;
/** Movement first: the card is about who is coming and going this month. */
const PRIORITY: Record<NoteStatus, number> = { arriving: 0, passing: 1, leaving: 2, visiting: 3, resident: 4, recorded: 5 };

function seasonalStatus(s: CellSpecies, i: number): NoteStatus {
  const prev = s.m[(i + 11) % 12] === 1;
  const next = s.m[(i + 1) % 12] === 1;
  if (!prev) return 'arriving';
  if (!next) return 'leaving';
  return 'visiting';
}

function statusOf(s: CellSpecies, i: number): NoteStatus {
  if (s.p === 'resident') return 'resident';
  if (s.p === 'passage') return 'passing';
  if (s.p === 'seasonal') return seasonalStatus(s, i);
  return 'recorded';
}

/** Who is here this month and what they are doing: the field-journal card for a place. */
export function fieldNotes(cell: CellDetail, month: Month, limit = DEFAULT_ROWS): FieldNotes {
  const i = month - 1;
  const bySpecies = new Map(cell.species.map((s) => [s.k, s]));
  const listed = wildlifeHere(cell, month).flatMap((g) => g.species)
    .map((s) => ({ key: s.key, share: s.share, status: statusOf(bySpecies.get(s.key)!, i) }))
    .sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status] || b.share - a.share);
  return { rows: listed.slice(0, limit), total: listed.length };
}
