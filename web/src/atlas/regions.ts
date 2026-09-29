import type { SpeciesRange } from '../types';

/**
 * Coarse regions for saying where a species is each month in words. India comes from the atlas grid itself
 * (the cells with species lists); the rest are simple boxes, checked in order, so the Himalaya wins over
 * East Asia and the Middle East over Africa. Good enough for "Jun–Aug · East Asia", not for borders.
 */
const BOXES: readonly { name: string; lat: [number, number]; lng: [number, number] }[] = [
  { name: 'the Himalaya and Tibet', lat: [27, 40], lng: [75, 100] },
  { name: 'South Asia', lat: [5, 37], lng: [60, 98] },
  { name: 'Southeast Asia', lat: [-11, 28], lng: [92, 141] },
  { name: 'Siberia and the Russian Far East', lat: [50, 78], lng: [60, 180] },
  { name: 'East Asia', lat: [20, 55], lng: [100, 146] },
  { name: 'Central Asia', lat: [35, 55], lng: [46, 100] },
  { name: 'the Middle East', lat: [12, 42], lng: [34, 63] },
  { name: 'Europe', lat: [35, 72], lng: [-25, 46] },
  { name: 'North Africa', lat: [15, 37], lng: [-18, 34] },
  { name: 'East Africa', lat: [-12, 15], lng: [28, 52] },
  { name: 'southern Africa', lat: [-36, -12], lng: [10, 42] },
  { name: 'West and Central Africa', lat: [-12, 15], lng: [-18, 28] },
  { name: 'Australia', lat: [-45, -10], lng: [110, 155] },
  { name: 'North America', lat: [15, 75], lng: [-170, -50] },
  { name: 'South America', lat: [-56, 15], lng: [-82, -34] },
  { name: 'the Indian Ocean', lat: [-40, 25], lng: [40, 110] },
];
export const INDIA = 'India';
const ELSEWHERE = 'elsewhere';

export function regionOf(lng: number, lat: number, inIndia: boolean): string {
  if (inIndia) return INDIA;
  const b = BOXES.find((r) => lat >= r.lat[0] && lat < r.lat[1] && lng >= r.lng[0] && lng < r.lng[1]);
  return b?.name ?? ELSEWHERE;
}

export interface MonthPlace {
  /** region holding most of the month's recorded presence, null when nothing was recorded */
  readonly region: string | null;
  /** that region's share of the month's presence, 0..1 */
  readonly share: number;
  /** presence-weighted centre of the species inside that region */
  readonly centre: { lng: number; lat: number } | null;
}

export interface JourneyRow { readonly from: number; readonly to: number; readonly region: string; readonly share: number; readonly centre: { lng: number; lat: number } }

/** Where the species' recorded presence sits each month, by region (months 0..11). */
export function monthlyRegions(range: SpeciesRange, cellSize: number, isIndia: (id: string) => boolean): { months: MonthPlace[]; india: number[] } {
  const cells = Object.entries(range.cells).map(([id, c]) => {
    const [lat, lng] = id.split('_').map(Number) as [number, number];
    const cLng = lng + cellSize / 2; const cLat = lat + cellSize / 2;
    return { r: c.r, lng: cLng, lat: cLat, region: regionOf(cLng, cLat, isIndia(id)) };
  });
  const india: number[] = [];
  const months = Array.from({ length: 12 }, (_, m): MonthPlace => {
    const by = new Map<string, { w: number; lng: number; lat: number }>();
    let total = 0;
    for (const c of cells) {
      const r = c.r[m] ?? 0;
      if (r <= 0) continue;
      total += r;
      const acc = by.get(c.region) ?? { w: 0, lng: 0, lat: 0 };
      by.set(c.region, { w: acc.w + r, lng: acc.lng + c.lng * r, lat: acc.lat + c.lat * r });
    }
    india.push(total > 0 ? (by.get(INDIA)?.w ?? 0) / total : 0);
    if (total === 0) return { region: null, share: 0, centre: null };
    const [region, acc] = [...by.entries()].sort((a, b) => b[1].w - a[1].w)[0]!;
    return { region, share: acc.w / total, centre: { lng: acc.lng / acc.w, lat: acc.lat / acc.w } };
  });
  return { months, india };
}

/** Consecutive months in the same region become one row, wrapping December into January. */
export function journeyRows(months: readonly MonthPlace[]): JourneyRow[] {
  const known = months.map((m, i) => ({ ...m, i })).filter((m) => m.region !== null);
  if (!known.length) return [];
  // start the cycle at a region change so a Dec–Jan stay is one row
  const start = months.findIndex((m, i) => m.region !== null && months[(i + 11) % 12]?.region !== m.region);
  const order = Array.from({ length: 12 }, (_, k) => (Math.max(0, start) + k) % 12);
  const rows: JourneyRow[] = [];
  for (const i of order) {
    const m = months[i]!;
    if (!m.region || !m.centre) continue;
    const last = rows.at(-1);
    if (last && last.region === m.region && (last.to + 1) % 12 === i) rows[rows.length - 1] = { ...last, to: i, share: Math.max(last.share, m.share) };
    else rows.push({ from: i, to: i, region: m.region, share: m.share, centre: m.centre });
  }
  // read in calendar order: begin with the leg that holds January (or the earliest month)
  const covers = (r: JourneyRow, m: number) => (r.from <= r.to ? m >= r.from && m <= r.to : m >= r.from || m <= r.to);
  const first = Math.max(0, rows.findIndex((r) => covers(r, 0)));
  return [...rows.slice(first), ...rows.slice(0, first)];
}
