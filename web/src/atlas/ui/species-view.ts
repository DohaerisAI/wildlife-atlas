import { formatRange, weightComparison, type ProfileImage, type SpeciesProfile } from '../../species/profile';
import type { Meta, SpeciesIndexEntry } from '../../types';
import { h, replaceChildren } from '../../ui/dom';
import type { SpeciesSummary } from '../species-summary';
import { fmtLat, fmtLng, monthBars, monthName, notAvailable, section } from './bits';

export interface SpeciesViewData {
  readonly entry: SpeciesIndexEntry;
  readonly profile: SpeciesProfile | null;
  readonly summary: SpeciesSummary | null;
  readonly month: number;
  readonly meta: Meta;
}

export interface SpeciesViewHandlers {
  onJourney(lng: number, lat: number): void;
  onMonth(month: number): void;
}

const STATUS_TONE: Record<string, string> = { LC: 'good', NT: 'warn', VU: 'warn', EN: 'bad', CR: 'bad', EW: 'bad', EX: 'bad', DD: 'muted' };
const BEHAVIOUR: Record<SpeciesSummary['behaviour'], string> = {
  resident: 'Resident wherever it was recorded',
  migratory: 'Migratory or seasonal across its recorded range',
  mixed: 'Resident in some places, seasonal in others',
};

function gallery(name: string, images: readonly ProfileImage[]): HTMLElement {
  if (!images.length) return h('figure', { class: 'sv-photo is-empty' }, h('p', { class: 'na' }, 'Photo: not available from current sources'));
  const bg = h('img', { class: 'sv-bg', alt: '', 'aria-hidden': 'true' });
  const img = h('img', { class: 'sv-img', decoding: 'async' });
  const credit = h('figcaption', { class: 'sv-credit' });
  const dots = h('div', { class: 'sv-dots' });
  const show = (i: number) => {
    const im = images[i]!;
    img.src = im.url; bg.src = im.url;
    img.alt = `${name}${im.caption ? `, ${im.caption.toLowerCase()}` : ''}`;
    replaceChildren(credit, `${im.caption ? `${im.caption} · ` : ''}${im.artist} · `, h('a', { href: im.page, target: '_blank', rel: 'noopener' }, im.license));
    dots.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
  };
  if (images.length > 1) images.forEach((im, i) => dots.append(h('button', { type: 'button', class: 'sv-dot', 'aria-label': im.caption || `Photo ${i + 1}`, onclick: () => show(i) }, im.caption || `${i + 1}`)));
  const fig = h('figure', { class: 'sv-photo' }, h('div', { class: 'sv-frame' }, bg, img), dots, credit);
  img.addEventListener('error', () => fig.replaceChildren(h('p', { class: 'na' }, 'Photo could not load from Wikimedia Commons.'), credit));
  show(0);
  return fig;
}

function glance(p: SpeciesProfile | null, s: SpeciesSummary | null): HTMLElement {
  const facts = h('dl', { class: 'facts' });
  const add = (k: string, v: string, tone = '') => facts.append(h('div', { class: 'fact' }, h('dt', {}, k), h('dd', { class: tone ? `tone-${tone}` : '' }, v)));
  const f = p?.facts;
  add('Wingspan', f?.wingspan ? formatRange(f.wingspan) : '—');
  add('Length', f?.length ? formatRange(f.length) : '—');
  add('Weight', f?.mass ? formatRange(f.mass) : '—');
  add('Status', f?.status?.label ?? '—', f?.status ? STATUS_TONE[f.status.code] ?? '' : '');
  const scale = weightComparison(f?.mass);
  return h('div', {},
    facts,
    scale ? h('p', { class: 'sv-scale' }, `${scale}.`) : null,
    s ? h('p', { class: 'sv-line' }, BEHAVIOUR[s.behaviour], '.') : null,
    !f?.wingspan || !f?.length || !f?.mass ? h('p', { class: 'na' }, '— not available from current sources') : null);
}

function seasonal(s: SpeciesSummary | null, month: number, onMonth: (m: number) => void): HTMLElement {
  if (!s) return notAvailable('No seasonal data loaded for this species.');
  const bars = monthBars(s.presence, month, { height: 44, labels: true });
  bars.classList.add('is-large');
  bars.querySelectorAll('rect').forEach((r, i) => r.addEventListener('click', () => onMonth(i + 1)));
  return h('div', {},
    bars,
    h('p', { class: 'sv-line' }, `Most recorded in ${monthName(s.peakMonth)}, fewest in ${monthName(s.lowMonth)}. `,
      `Present in ${s.cells[month]} of ${s.totalCells} grid cells in ${monthName(month)}.`),
    h('p', { class: 'legend-note' }, 'Bars: share of the peak month\'s recorded presence. Glows on the globe show the same share, not individual animals.'));
}

function journey(s: SpeciesSummary | null, month: number, onJourney: (lng: number, lat: number) => void): HTMLElement {
  const centres = s?.centres ?? [];
  const now = centres[month];
  const known = centres.map((c, i) => (c ? { ...c, i } : null)).filter((c): c is NonNullable<typeof c> => c !== null);
  if (!s || known.length < 2) return notAvailable();
  const north = known.reduce((a, b) => (b.lat > a.lat ? b : a));
  const south = known.reduce((a, b) => (b.lat < a.lat ? b : a));
  const lat = known.map((c) => c.lat);
  const lo = Math.min(...lat); const hi = Math.max(...lat);
  const pts = centres.map((c, i) => (c ? `${i * 10 + 5},${34 - ((c.lat - lo) / Math.max(1, hi - lo)) * 28}` : null)).filter(Boolean).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 40');
  svg.setAttribute('class', 'sv-journey');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<polyline points="${pts}" /><circle cx="${month * 10 + 5}" cy="${now ? 34 - ((now.lat - lo) / Math.max(1, hi - lo)) * 28 : 38}" r="2.6" />`;
  const text = s.shiftDeg < 4
    ? 'Its recorded centre stays in about the same place all year.'
    : `Its recorded centre moves ${Math.round(s.shiftDeg)}° of latitude through the year: furthest north in ${monthName(north.i)} (${fmtLat(north.lat)}), furthest south in ${monthName(south.i)} (${fmtLat(south.lat)}).`;
  return h('div', {},
    svg,
    h('p', { class: 'sv-line' }, text),
    now ? h('button', { class: 'btn-quiet', type: 'button', onclick: () => onJourney(now.lng, now.lat) }, `Go to ${monthName(month)}'s centre · ${fmtLat(now.lat)}, ${fmtLng(now.lng)}`) : null,
    h('p', { class: 'legend-note' }, 'Centre of recorded presence each month, weighted by records. A species-level pattern, not one animal\'s route.'));
}

function evidence(d: SpeciesViewData): HTMLElement {
  const src = d.profile?.sources ?? [];
  return h('div', {},
    h('p', { class: 'sv-line' }, `Presence: ${d.meta.source.name}${d.meta.source.years ? `, ${d.meta.source.years}` : ''}. ${d.meta.measure}`),
    d.meta.source.demo ? h('p', { class: 'demo-flag' }, 'Synthetic demo data: patterns are invented, not evidence.') : null,
    src.length ? h('p', { class: 'sources' }, 'Profile: ', ...src.flatMap((s, i) => [i ? ' · ' : '', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.label)])) : h('p', { class: 'na' }, 'Profile sources: not available from current sources'),
    d.profile?.licence_note ? h('p', { class: 'legend-note' }, d.profile.licence_note) : null,
    h('p', { class: 'sources' }, h('a', { href: `https://www.gbif.org/species/${encodeURIComponent(d.entry.k)}`, target: '_blank', rel: 'noopener' }, 'GBIF species page'), ' · ',
      h('a', { href: `https://ebird.org/explore?q=${encodeURIComponent(d.entry.sci)}`, target: '_blank', rel: 'noopener' }, 'eBird')));
}

/** The species profile (spec 3.3): complete where sources allow, honest where they don't. */
export function speciesView(d: SpeciesViewData, handlers: SpeciesViewHandlers): HTMLElement {
  const p = d.profile;
  const name = p?.name || d.entry.name || d.entry.sci;
  const extract = p?.extract ? p.extract.split(/(?<=\.)\s/).slice(0, 4).join(' ') : '';
  return h('article', { class: 'species-view', 'aria-label': `About the ${name}` },
    gallery(name, p?.images ?? []),
    h('header', { class: 'sv-head' },
      h('p', { class: 'kicker' }, d.entry.family || 'Species'),
      h('h2', { class: 'sv-name' }, name),
      h('p', { class: 'sv-sci' }, d.entry.sci),
      p?.description ? h('p', { class: 'sv-desc' }, p.description) : null),
    section('At a glance', glance(p, d.summary)),
    section(`Seasonal world · ${monthName(d.month)}`, seasonal(d.summary, d.month, handlers.onMonth)),
    section('Journey', journey(d.summary, d.month, handlers.onJourney)),
    section('Conservation',
      p?.facts.status ? h('p', { class: 'sv-line' }, `IUCN Red List: `, h('strong', { class: `tone-${STATUS_TONE[p.facts.status.code] ?? ''}` }, p.facts.status.label), ' (via Wikidata).') : notAvailable('Assessment: not available from current sources'),
      h('p', { class: 'na' }, 'Threats and assessment date: not available from current sources')),
    extract ? section('About', h('p', { class: 'sv-extract' }, extract)) : null,
    section('Evidence', evidence(d)));
}
