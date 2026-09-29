import type { CellDetail, Meta, SpeciesIndexEntry, SpeciesRange } from '../types';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** RFC 4180 field: quote when it holds a comma, quote or newline; guard against spreadsheet formulas. */
export function csvField(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@]/.test(s) && typeof v === 'string') s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const line = (fields: readonly (string | number)[]) => fields.map(csvField).join(',');

/** Every species in a grid cell with its records per month; the first row after the header holds all records (effort). */
export function placeCsv(cell: CellDetail, names: ReadonlyMap<string, SpeciesIndexEntry>): string {
  const head = ['gbif_taxon_key', 'scientific_name', 'common_name', 'presence', ...MONTHS.map((m) => `records_${m}`), ...MONTHS.map((m) => `present_${m}`)];
  const effort = ['', 'ALL BIRD RECORDS', '', '', ...cell.total, ...MONTHS.map(() => '')];
  const rows = [...cell.species].sort((a, b) => b.c.reduce((x, y) => x + y, 0) - a.c.reduce((x, y) => x + y, 0)).map((s) => {
    const e = names.get(s.k);
    return [s.k, e?.sci ?? '', e?.name ?? '', s.p, ...s.c, ...s.m];
  });
  return [line(head), line(effort), ...rows.map(line)].join('\n') + '\n';
}

/** A species' monthly presence (share of its peak) in every 1° cell where it was recorded. */
export function speciesCsv(range: SpeciesRange, cellSize: number, entry: SpeciesIndexEntry): string {
  const peak = Math.max(0, ...Object.values(range.cells).flatMap((c) => c.r)) || 1;
  const head = ['gbif_taxon_key', 'scientific_name', 'cell_id', 'lat_min', 'lng_min', 'cell_size_deg', 'presence', ...MONTHS.map((m) => `rate_${m}`), ...MONTHS.map((m) => `of_peak_${m}`)];
  const rows = Object.entries(range.cells).map(([id, c]) => {
    const [lat, lng] = id.split('_').map(Number) as [number, number];
    return [entry.k, entry.sci, id, lat, lng, cellSize, c.p, ...c.r.map((r) => +r.toPrecision(6)), ...c.r.map((r) => +(r / peak).toFixed(4))];
  });
  return [line(head), ...rows.map(line)].join('\n') + '\n';
}

/** Suggested citation for what the visitor is looking at. */
export function citation(meta: Meta, what: string, accessed: Date): string {
  const day = accessed.toISOString().slice(0, 10);
  return `Wildlife Atlas (${accessed.getUTCFullYear()}). ${what}. Built from ${meta.source.name}, ${meta.source.years}; data generated ${meta.generated.slice(0, 10)}. https://github.com/DohaerisAI/wildlife-atlas (accessed ${day}).`;
}

/** Save text as a file in the browser. */
export function download(filename: string, text: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
