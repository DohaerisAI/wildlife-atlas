import { COVERAGE_LABEL, MONTH_LONG } from '../../constants';
import { className } from '../../engine/living-earth/land-classes';
import { readingLines, readingLinesV2, type EnvReading, type EnvReadingV2 } from '../../engine/living-earth/reading';
import type { Coverage, SpeciesIndexEntry } from '../../types';
import { h } from '../../ui/dom';
import type { Doing, PlaceRow, PlaceSummary, Reported } from '../place-summary';
import type { Place } from '../store';
import { doingTag, fmtLat, fmtLng, fold, monthBars, monthName, notAvailable, thumb } from './bits';

/** Which species the list shows. 'moving' = arriving, leaving or passing through this month. */
export type PlaceFilter = 'moving' | 'arriving' | 'leaving' | 'passing' | 'resident' | 'staying' | 'all';

export interface PlaceViewData {
  readonly place: Place;
  /** 0 = January */
  readonly month: number;
  readonly summary: PlaceSummary | null;
  /** 'none' when the place has no species list */
  readonly status: 'loading' | 'ready' | 'none' | 'error';
  readonly coverage: Coverage | null;
  readonly env: { reading: EnvReading; onLand: boolean; v2: EnvReadingV2 | null } | null;
  readonly species: ReadonlyMap<string, SpeciesIndexEntry>;
  readonly thumbOf: (sci: string) => string | null;
  readonly filter: PlaceFilter;
  /** rows shown before "show more" */
  readonly shown: number;
  readonly cellSize: number;
}

export interface PlaceViewHandlers {
  onSpecies(key: string): void;
  onMonth(month: number): void;
  onShowMap(): void;
  onFilter(f: PlaceFilter): void;
  onMore(): void;
  onDownload(): void;
  onCite(): void;
}

/** below this many records in the month the list is too thin to read much into */
const THIN_RECORDS = 100;
const REPORTED_LABEL: Record<Reported, string> = { often: 'Often reported', sometimes: 'Sometimes reported', rarely: 'Rarely reported' };
const plural = (n: number, word: string) => `${n.toLocaleString('en-IN')} ${word}${n === 1 ? '' : 's'}`;
const MOVING: readonly Doing[] = ['arriving', 'leaving', 'passing'];
const FILTERS: readonly { id: PlaceFilter; label: string; test: (r: PlaceRow) => boolean }[] = [
  { id: 'moving', label: 'On the move', test: (r) => MOVING.includes(r.doing) },
  { id: 'arriving', label: 'Arriving', test: (r) => r.doing === 'arriving' },
  { id: 'leaving', label: 'Leaving', test: (r) => r.doing === 'leaving' },
  { id: 'passing', label: 'Passing through', test: (r) => r.doing === 'passing' },
  { id: 'staying', label: 'Visiting', test: (r) => r.doing === 'staying' },
  { id: 'resident', label: 'Year-round', test: (r) => r.doing === 'resident' },
  { id: 'all', label: 'All', test: () => true },
];
const ORDER: Record<Doing, number> = { arriving: 0, passing: 1, leaving: 2, staying: 3, resident: 4, recorded: 5 };

/** Rows for a filter, most-reported first. Exposed for tests and for the default choice. */
export function filterRows(summary: PlaceSummary, filter: PlaceFilter): PlaceRow[] {
  const f = FILTERS.find((x) => x.id === filter) ?? FILTERS.at(-1)!;
  return summary.groups.flatMap((g) => g.rows).filter(f.test)
    .sort((a, b) => (filter === 'all' || filter === 'moving' ? ORDER[a.doing] - ORDER[b.doing] : 0) || b.count - a.count);
}

function row(d: PlaceViewData, r: PlaceRow, onSpecies: (k: string) => void): HTMLElement {
  const sp = d.species.get(r.key);
  const name = sp?.name || sp?.sci || r.key;
  return h('li', {},
    h('button', { class: 'sp-row', type: 'button', onclick: () => onSpecies(r.key), 'aria-label': `${name}: ${r.doing}, ${REPORTED_LABEL[r.reported].toLowerCase()}` },
      thumb(sp ? d.thumbOf(sp.sci) : null, name),
      h('span', { class: 'sp-row-main' },
        h('span', { class: 'sp-row-name' }, name),
        h('span', { class: 'sp-row-meta' }, doingTag(r.doing), h('span', { class: `sp-row-share rep-${r.reported}` }, `${REPORTED_LABEL[r.reported]} · ${plural(r.count, 'record')}`))),
      monthBars(r.months, d.month, { label: `${name}: recorded in ${r.months.filter((v) => v > 0).length} months` })));
}

function environment(d: PlaceViewData): HTMLElement {
  if (!d.env) return notAvailable('Environment readings are loading or unavailable.');
  const lines = [...(d.env.v2 ? readingLinesV2(d.env.v2, d.env.onLand, className) : []), ...readingLines(d.env.reading, d.env.onLand)];
  return h('dl', { class: 'env-list' }, ...lines.map((l) => h('div', { class: 'env-row' }, h('dt', {}, l.label), h('dd', {}, l.value, h('span', { class: 'env-src' }, l.source)))));
}

function research(d: PlaceViewData, s: PlaceSummary | null, handlers: PlaceViewHandlers): HTMLElement {
  const { place } = d;
  const bounds = place.cellId ? (() => { const [lat, lng] = place.cellId.split('_').map(Number) as [number, number]; return `${lat}° to ${lat + d.cellSize}°N, ${lng}° to ${lng + d.cellSize}°E`; })() : null;
  return h('div', { class: 'research' },
    h('dl', { class: 'env-list' },
      h('div', { class: 'env-row' }, h('dt', {}, 'Grid cell'), h('dd', {}, place.cellId ?? 'outside the India grid', bounds ? h('span', { class: 'env-src' }, bounds) : null)),
      s ? h('div', { class: 'env-row' }, h('dt', {}, 'Effort'), h('dd', {}, `${plural(s.records, 'record')} in ${MONTH_LONG[d.month]}`, h('span', { class: 'env-src' }, 'all bird records in the cell, every year combined'))) : null,
      h('div', { class: 'env-row' }, h('dt', {}, 'Presence'), h('dd', {}, 'Year-round, seasonal, passage or uncertain per species', h('span', { class: 'env-src' }, 'classified from the monthly pattern of records (pipeline classify.py)')))),
    s ? h('div', { class: 'links' },
      h('button', { class: 'btn-quiet', type: 'button', onclick: handlers.onDownload }, 'Download species list (CSV)'),
      h('button', { class: 'btn-quiet', type: 'button', onclick: handlers.onCite }, 'Copy citation')) : null,
    h('p', { class: 'legend-note' }, 'The CSV has every species in the cell with records and presence for all 12 months, plus total records per month so you can normalise for effort. Counts are GBIF occurrences, not individuals, and depend on how many people report.'));
}

/** "Recorded here" (spec 3.1), built to fit without much scrolling: header, one filtered list, details folded. */
export function placeView(d: PlaceViewData, handlers: PlaceViewHandlers): HTMLElement {
  const { place, summary } = d;
  const title = place.name ?? `${fmtLat(place.lat)}, ${fmtLng(place.lng)}`;
  const head = h('header', { class: 'pv-head' },
    h('p', { class: 'kicker' }, `Recorded here · ${monthName(d.month)}`),
    h('h2', { class: 'pv-name' }, title),
    h('p', { class: 'pv-detail' }, [place.detail, `${place.lat.toFixed(2)}°, ${place.lng.toFixed(2)}°`].filter(Boolean).join(' · ')),
    h('div', { class: 'pv-tags' },
      d.coverage ? h('span', { class: `coverage cov-${d.coverage}` }, COVERAGE_LABEL[d.coverage]) : null,
      place.cellId ? h('button', { class: 'coverage cov-area', type: 'button', onclick: handlers.onShowMap, title: 'Species are listed for the whole grid square around this point. It is outlined on the street map.' }, `~${Math.round(d.cellSize * 110)} km square`) : null));

  if (d.status === 'loading') return h('article', { class: 'place-view' }, head, h('p', { class: 'na pad' }, 'Loading the species list…'));
  if (d.status === 'error') return h('article', { class: 'place-view' }, head, notAvailable('The species list for this place could not load.'));
  if (d.status === 'none' || !summary) {
    return h('article', { class: 'place-view' }, head,
      h('p', { class: 'na pad' }, 'Species lists cover India for now. Elsewhere the globe shows the ranges of featured species.'),
      fold('Environment this month', true, environment(d)));
  }

  const counts = new Map(FILTERS.map((f) => [f.id, filterRows(summary, f.id).length]));
  const rows = filterRows(summary, d.filter);
  const strip = monthBars(summary.richness, d.month, { height: 26, labels: true, label: 'Species recorded here in each month' });
  strip.classList.add('is-large', 'pv-strip');
  strip.querySelectorAll('rect').forEach((r, i) => r.addEventListener('click', () => handlers.onMonth(i + 1)));

  return h('article', { class: 'place-view', 'aria-label': `Recorded here: ${title}` },
    head,
    h('div', { class: 'pv-summary' },
      h('p', { class: 'pv-lede' }, h('strong', {}, String(summary.total)), ' species', summary.moving ? ' · ' : null, summary.moving ? h('strong', {}, String(summary.moving)) : null, summary.moving ? ' on the move' : null),
      h('p', { class: 'legend-note pv-basis' }, `From ${plural(summary.records, 'bird record')} for ${monthName(d.month)}, all years combined.`, summary.records < THIN_RECORDS ? ' Few people report here, so this list is patchy.' : null),
      strip),
    h('div', { class: 'chips-bar', role: 'tablist', 'aria-label': 'Show species' },
      ...FILTERS.filter((f) => f.id === 'all' || (counts.get(f.id) ?? 0) > 0).map((f) => h('button', {
        class: 'fchip', type: 'button', role: 'tab', 'aria-selected': String(f.id === d.filter), onclick: () => handlers.onFilter(f.id),
      }, f.label, h('span', { class: 'n' }, String(counts.get(f.id) ?? 0))))),
    rows.length
      ? h('ul', { class: 'sp-list pv-list' }, ...rows.slice(0, d.shown).map((r) => row(d, r, handlers.onSpecies)))
      : h('p', { class: 'na pad' }, 'None this month.'),
    rows.length > d.shown ? h('button', { class: 'btn-quiet pv-more', type: 'button', onclick: handlers.onMore }, `Show ${Math.min(24, rows.length - d.shown)} more of ${rows.length}`) : null,
    h('p', { class: 'legend-note pv-note' }, 'Sightings shared to GBIF (mostly eBird and iNaturalist) in the grid square. "Often reported" depends on how easy a bird is to spot and how many people look: this is what is possible here, not a promise.'),
    fold('Environment this month', false, environment(d)),
    fold('For researchers', false, research(d, summary, handlers)),
    fold('Help document wildlife', false,
      h('p', { class: 'sv-line' }, 'Records with a clear identification, date, location and a photo or sound make these lists better.'),
      h('p', { class: 'links' },
        h('a', { class: 'btn-quiet', href: 'https://ebird.org/submit', target: '_blank', rel: 'noopener' }, 'Submit to eBird'),
        h('a', { class: 'btn-quiet', href: 'https://www.inaturalist.org/observations/upload', target: '_blank', rel: 'noopener' }, 'Upload to iNaturalist'))));
}
