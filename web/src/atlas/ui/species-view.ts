import { formatRange, weightComparison, type ProfileImage, type SpeciesProfile, type Taxon } from '../../species/profile';
import type { Meta, SpeciesIndexEntry } from '../../types';
import { h, replaceChildren } from '../../ui/dom';
import type { SpeciesSummary } from '../species-summary';
import { fold, monthBars, monthName, notAvailable, section } from './bits';
import { journeyRows, type JourneyRow, type MonthPlace } from '../regions';

export interface SpeciesViewData {
  readonly entry: SpeciesIndexEntry;
  readonly profile: SpeciesProfile | null;
  readonly summary: SpeciesSummary | null;
  readonly month: number;
  readonly meta: Meta;
  readonly regions: { readonly months: readonly MonthPlace[]; readonly india: readonly number[] } | null;
}

export interface SpeciesViewHandlers {
  onJourney(lng: number, lat: number, month: number): void;
  onMonth(month: number): void;
  onDownload(): void;
  onCite(): void;
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

function identity(p: SpeciesProfile | null, entry: SpeciesIndexEntry): HTMLElement {
  const t = p?.taxonomy;
  const taxon = (x: Taxon | undefined) => (x ? (x.name ? `${x.name} (${x.scientific})` : x.scientific) : null);
  const rows: [string, string | null][] = [
    ['Class', taxon(t?.class)], ['Order', taxon(t?.order)], ['Family', taxon(t?.family) ?? entry.family ?? null], ['Genus', taxon(t?.genus)],
  ];
  const known = rows.filter((r): r is [string, string] => r[1] !== null);
  return h('div', {},
    known.length ? h('dl', { class: 'facts taxa' }, ...known.map(([k, v]) => h('div', { class: 'fact' }, h('dt', {}, k), h('dd', {}, v)))) : notAvailable('Taxonomy: not available from current sources'),
    p?.other_names?.length ? h('p', { class: 'sv-line' }, 'Also called ', p.other_names.join(', '), '.') : null);
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

const span = (from: number, to: number) => (from === to ? monthName(from) : `${monthName(from).slice(0, 3)} – ${monthName(to).slice(0, 3)}`);

/** In words: which months it spends where. Built from where most of its recorded presence sits each month. */
function whereThroughYear(r: { months: readonly MonthPlace[]; india: readonly number[] } | null, month: number, onGo: (lng: number, lat: number, month: number) => void): HTMLElement {
  if (!r) return notAvailable();
  const rows = journeyRows(r.months);
  if (!rows.length) return notAvailable('No monthly records to place.');
  const inIndia = r.india.map((v, i) => ({ v, i })).filter((x) => x.v >= 0.05);
  const peakIndia = inIndia.reduce((a, b) => (b.v > a.v ? b : a), { v: 0, i: -1 });
  const indiaLine = !inIndia.length ? 'Not recorded in India in any month.'
    : inIndia.length === 12 ? `Recorded in India all year, most in ${monthName(peakIndia.i)}.`
      : `In India: ${inIndia.map((x) => monthName(x.i).slice(0, 3)).join(', ')}, most in ${monthName(peakIndia.i)}.`;
  const lede = rows.length === 1 ? `Recorded mostly in ${rows[0]!.region} all year.` : `Spends the year in ${new Set(rows.map((x) => x.region)).size} regions.`;
  const inRow = (x: JourneyRow) => (x.from <= x.to ? month >= x.from && month <= x.to : month >= x.from || month <= x.to);
  return h('div', {},
    h('p', { class: 'sv-line' }, lede, ' ', indiaLine),
    h('ol', { class: 'legs' }, ...rows.map((x) => h('li', {},
      h('button', { class: `leg${inRow(x) ? ' is-now' : ''}`, type: 'button', onclick: () => onGo(x.centre.lng, x.centre.lat, x.from + 1), title: `Go to ${x.region} in ${monthName(x.from)}` },
        h('span', { class: 'leg-months' }, span(x.from, x.to)),
        h('span', { class: 'leg-region' }, x.region),
        h('span', { class: 'leg-share' }, `${Math.round(x.share * 100)} %`))))),
    h('p', { class: 'legend-note' }, 'Where most of its recorded sightings are each month; the % is that region\'s share at its peak. Tap a row to go there. A pattern for the species from sightings, not one bird\'s route.'));
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
    section('Where it is through the year', whereThroughYear(d.regions, d.month, handlers.onJourney)),
    fold('Identity', false, identity(p, d.entry)),
    fold('Conservation', false,
      p?.facts.status ? h('p', { class: 'sv-line' }, `IUCN Red List: `, h('strong', { class: `tone-${STATUS_TONE[p.facts.status.code] ?? ''}` }, p.facts.status.label), ' (via Wikidata).') : notAvailable('Assessment: not available from current sources'),
      h('p', { class: 'na' }, 'Threats and assessment date: not available from current sources')),
    extract ? fold('About', false, h('p', { class: 'sv-extract' }, extract)) : null,
    fold('For researchers', false, evidence(d),
      h('p', { class: 'links' },
        h('button', { class: 'btn-quiet', type: 'button', onclick: handlers.onDownload }, 'Download monthly presence (CSV)'),
        h('button', { class: 'btn-quiet', type: 'button', onclick: handlers.onCite }, 'Copy citation')),
      h('p', { class: 'legend-note' }, 'One row per 1° cell where it was recorded: presence class, the monthly rate (share of the cell\'s bird records that are this species) and the same scaled to its peak month.')));
}
