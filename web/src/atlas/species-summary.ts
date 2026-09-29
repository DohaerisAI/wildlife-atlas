import type { SpeciesRange } from '../types';

export interface MonthCentre { readonly lng: number; readonly lat: number }

export interface SpeciesSummary {
  /** grid cells with any presence, per month */
  readonly cells: readonly number[];
  /** summed presence per month, 0..1 against the peak month */
  readonly presence: readonly number[];
  readonly peakMonth: number;
  readonly lowMonth: number;
  /** presence-weighted centre per month, null when nothing was recorded */
  readonly centres: readonly (MonthCentre | null)[];
  /** degrees of latitude between the northern- and southernmost monthly centres */
  readonly shiftDeg: number;
  readonly behaviour: 'resident' | 'migratory' | 'mixed';
  readonly totalCells: number;
}

const DEG = Math.PI / 180;

/** Cell ids are "lat_lng" of the south-west corner. */
const cellCentre = (id: string, size: number): [number, number] => {
  const [lat, lng] = id.split('_').map(Number) as [number, number];
  return [lng + size / 2, lat + size / 2];
};

/** What the recorded data says about a species through the year. Nothing here is from outside the data. */
export function speciesSummary(range: SpeciesRange, cellSize: number): SpeciesSummary {
  const entries = Object.entries(range.cells);
  const sums = Array.from({ length: 12 }, (_, m) => entries.reduce((a, [, c]) => a + (c.r[m] ?? 0), 0));
  const peak = Math.max(...sums, 0) || 1;
  const cells = Array.from({ length: 12 }, (_, m) => entries.filter(([, c]) => (c.r[m] ?? 0) > 0).length);
  const centres = Array.from({ length: 12 }, (_, m): MonthCentre | null => {
    let x = 0, y = 0, z = 0, w = 0;
    for (const [id, c] of entries) {
      const r = c.r[m] ?? 0;
      if (r <= 0) continue;
      const [lng, lat] = cellCentre(id, cellSize);
      x += Math.cos(lat * DEG) * Math.cos(lng * DEG) * r; y += Math.cos(lat * DEG) * Math.sin(lng * DEG) * r; z += Math.sin(lat * DEG) * r; w += r;
    }
    if (w === 0) return null;
    return { lng: Math.atan2(y, x) / DEG, lat: Math.atan2(z, Math.hypot(x, y)) / DEG };
  });
  const lats = centres.filter((c): c is MonthCentre => c !== null).map((c) => c.lat);
  const kinds = new Set(entries.map(([, c]) => c.p));
  const behaviour = kinds.size === 1 && kinds.has('resident') ? 'resident' : kinds.has('resident') ? 'mixed' : 'migratory';
  return {
    cells,
    presence: sums.map((s) => s / peak),
    peakMonth: sums.indexOf(Math.max(...sums)),
    lowMonth: sums.indexOf(Math.min(...sums)),
    centres,
    shiftDeg: lats.length ? Math.max(...lats) - Math.min(...lats) : 0,
    behaviour,
    totalCells: entries.length,
  };
}
