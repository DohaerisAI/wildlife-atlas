import { COVERAGE_LABEL, PRESENCE_LABEL } from '../../constants';
import type { EnvReading } from '../../engine/living-earth/reading';
import { readingLines, readingLinesV2, type EnvReadingV2 } from '../../engine/living-earth/reading';
import { className } from '../../engine/living-earth/land-classes';
import type { Coverage, SpeciesIndexEntry } from '../../types';
import { h } from '../../ui/dom';
import type { PlaceGroup, PlaceSummary } from '../place-summary';
import type { Place } from '../store';
import { doingTag, fmtLat, fmtLng, monthBars, monthName, notAvailable, section, thumb } from './bits';

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
}

export interface PlaceViewHandlers {
  onSpecies(key: string): void;
  onMonth(month: number): void;
}

const PREVIEW = 6;

function row(key: string, d: PlaceViewData, r: PlaceGroup['rows'][number], onSpecies: (k: string) => void): HTMLElement {
  const sp = d.species.get(key);
  const name = sp?.name || sp?.sci || key;
  return h('li', {},
    h('button', { class: 'sp-row', type: 'button', onclick: () => onSpecies(key) },
      thumb(sp ? d.thumbOf(sp.sci) : null, name),
      h('span', { class: 'sp-row-main' },
        h('span', { class: 'sp-row-name' }, name),
        h('span', { class: 'sp-row-meta' }, doingTag(r.doing), h('span', { class: 'sp-row-share' }, `${r.share >= 0.01 ? Math.round(r.share * 100) : '<1'}% of records`))),
      monthBars(r.months, d.month, { label: `${name}: ${r.months.filter((v) => v > 0).length} months with records` })));
}

function group(g: PlaceGroup, d: PlaceViewData, onSpecies: (k: string) => void): HTMLElement {
  const list = h('ul', { class: 'sp-list' }, ...g.rows.slice(0, PREVIEW).map((r) => row(r.key, d, r, onSpecies)));
  const more = g.rows.length > PREVIEW
    ? h('button', { class: 'btn-quiet', type: 'button', onclick: (e: Event) => {
      list.append(...g.rows.slice(PREVIEW).map((r) => row(r.key, d, r, onSpecies)));
      (e.currentTarget as HTMLElement).remove();
    } }, `Show all ${g.rows.length}`)
    : null;
  return h('div', { class: 'pv-group' }, h('h4', { class: 'pv-group-h' }, PRESENCE_LABEL[g.presence], h('span', { class: 'count' }, String(g.rows.length))), list, more);
}

/** The month's story first: who is arriving, leaving or passing through right now. */
function movers(d: PlaceViewData, summary: PlaceSummary, onSpecies: (k: string) => void): HTMLElement | null {
  const order = { arriving: 0, passing: 1, leaving: 2 } as Record<string, number>;
  const rows = summary.groups.flatMap((g) => g.rows).filter((r) => r.doing in order)
    .sort((a, b) => order[a.doing]! - order[b.doing]! || b.share - a.share);
  if (!rows.length) return null;
  return section(`On the move in ${monthName(d.month)}`,
    h('ul', { class: 'sp-list' }, ...rows.slice(0, PREVIEW).map((r) => row(r.key, d, r, onSpecies))),
    rows.length > PREVIEW ? h('p', { class: 'legend-note' }, `${rows.length - PREVIEW} more below, in their groups.`) : null);
}

function environment(d: PlaceViewData): HTMLElement {
  if (!d.env) return notAvailable('Environment readings are loading or unavailable.');
  const lines = [...(d.env.v2 ? readingLinesV2(d.env.v2, d.env.onLand, className) : []), ...readingLines(d.env.reading, d.env.onLand)];
  return h('dl', { class: 'env-list' }, ...lines.map((l) =>
    h('div', { class: 'env-row' }, h('dt', {}, l.label), h('dd', {}, l.value, h('span', { class: 'env-src' }, l.source)))));
}

/** "Wildlife here" (spec 3.1): who you might find this month, what they are doing, and why it is shown. */
export function placeView(d: PlaceViewData, handlers: PlaceViewHandlers): HTMLElement {
  const { place, summary } = d;
  const title = place.name ?? `${fmtLat(place.lat)}, ${fmtLng(place.lng)}`;
  const head = h('header', { class: 'pv-head' },
    h('p', { class: 'kicker' }, `Wildlife here · ${monthName(d.month)}`),
    h('h2', { class: 'pv-name' }, title),
    h('p', { class: 'pv-detail' }, [place.detail, `${place.lat.toFixed(2)}°, ${place.lng.toFixed(2)}°`].filter(Boolean).join(' · ')),
    d.coverage ? h('p', { class: `coverage cov-${d.coverage}` }, COVERAGE_LABEL[d.coverage]) : null);

  let body: (HTMLElement | null)[];
  if (d.status === 'loading') body = [h('p', { class: 'na' }, 'Loading the species list…')];
  else if (d.status === 'error') body = [notAvailable('The species list for this place could not load.')];
  else if (d.status === 'none' || !summary) body = [notAvailable('Species lists cover India for now. Elsewhere the globe shows the ranges of featured species.')];
  else {
    const bars = monthBars(summary.richness, d.month, { height: 40, labels: true, label: 'Species recorded here in each month' });
    bars.classList.add('is-large');
    bars.querySelectorAll('rect').forEach((r, i) => r.addEventListener('click', () => handlers.onMonth(i + 1)));
    body = [
      h('p', { class: 'pv-lede' }, h('strong', {}, String(summary.total)), ` species recorded in ${monthName(d.month)}`,
        summary.moving ? ' · ' : null, summary.moving ? h('strong', {}, String(summary.moving)) : null, summary.moving ? ' on the move' : null),
      section('Through the year', bars, h('p', { class: 'legend-note' }, 'Species recorded here each month. Tap a month to go there.')),
      movers(d, summary, handlers.onSpecies),
      section('Who is here', ...summary.groups.map((g) => group(g, d, handlers.onSpecies)),
        h('p', { class: 'legend-note' }, 'Listed from recorded sightings in this grid cell. A record means someone saw it, not that it is always there.')),
    ];
  }
  return h('article', { class: 'place-view', 'aria-label': `Wildlife here: ${title}` },
    head, ...body,
    section('Environment this month', environment(d)),
    section('Help document wildlife',
      h('p', { class: 'sv-line' }, 'Records with a clear identification, date, location and a photo or sound make these maps better.'),
      h('p', { class: 'links' },
        h('a', { class: 'btn-quiet', href: 'https://ebird.org/submit', target: '_blank', rel: 'noopener' }, 'Submit to eBird'),
        h('a', { class: 'btn-quiet', href: 'https://www.inaturalist.org/observations/upload', target: '_blank', rel: 'noopener' }, 'Upload to iNaturalist'),
        place.cellId ? h('a', { class: 'btn-quiet', href: `map.html?cell=${encodeURIComponent(place.cellId)}&m=${d.month + 1}` }, 'Open the detailed map') : null)));
}
