import { COVERAGE_LABEL, LIST_PREVIEW, MONTH_LONG, PRESENCE_LABEL } from '../constants';
import type { WikiSummary } from '../external';
import { cellsPerMonth, wildlifeHere } from '../listing';
import { ENTRY_POINTS, STORIES, type Story } from '../stories';
import type { CellDetail, CellIndexEntry, Meta, Month, Presence, SpeciesIndexEntry, SpeciesRange } from '../types';
import { cellLabel, formatShare, h } from './dom';
import { monthStrip } from './month-strip';

export interface PanelHandlers {
  onSpecies: (key: string) => void;
  onMonth: (m: Month) => void;
  onEntry: (center: [number, number], zoom: number) => void;
  onStory: (story: Story) => void;
  onClose: () => void;
  onBackToPlace: () => void;
}

const PRESENCE_ICON: Record<Presence, string> = { resident: '●', seasonal: '◐', passage: '→', uncertain: '?' };

export function presenceTag(p: Presence): HTMLElement {
  return h('span', { class: `tag tag-${p}` }, h('span', { 'aria-hidden': 'true' }, PRESENCE_ICON[p]), ' ', PRESENCE_LABEL[p]);
}

export function welcomeView(meta: Meta, handlers: PanelHandlers): HTMLElement {
  return h('section', { class: 'panel-body' },
    h('h1', { class: 'panel-title' }, 'Explore wildlife anywhere'),
    h('p', {}, 'Pick a month, then click a square on the map to see which birds have been recorded there at that time of year.'),
    h('h2', {}, 'Start somewhere'),
    h('div', { class: 'chips' }, ...ENTRY_POINTS.map((e) => h('button', { class: 'chip', onclick: () => handlers.onEntry(e.center, e.zoom) }, e.label))),
    h('h2', {}, 'Migration stories'),
    h('ul', { class: 'story-list' }, ...STORIES.map((s) => h('li', {}, h('button', { class: 'story-btn', onclick: () => handlers.onStory(s) }, '▶ ', s.title)))),
    evidenceNote(meta),
  );
}

export function placeView(
  cell: CellDetail, entry: CellIndexEntry, cellSize: number, month: Month,
  names: Map<string, SpeciesIndexEntry>, handlers: PanelHandlers, placeName: string | null,
): HTMLElement {
  const i = month - 1;
  const groups = wildlifeHere(cell, month);
  const cov = entry.coverage[i] ?? 'limited';
  const count = groups.reduce((n, g) => n + g.species.length, 0);

  return h('section', { class: 'panel-body' },
    h('div', { class: 'panel-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, `Wildlife here · ${MONTH_LONG[i]}`),
        h('h1', { class: 'panel-title' }, placeName ?? cellLabel(cell.id, cellSize)),
        placeName ? h('p', { class: 'muted small' }, cellLabel(cell.id, cellSize)) : null),
      closeButton(handlers)),
    h('p', { class: `coverage coverage-${cov}` }, h('strong', {}, COVERAGE_LABEL[cov]), ` · ${(entry.total[i] ?? 0).toLocaleString()} bird records this month`),
    cov === 'limited'
      ? h('p', { class: 'notice' }, 'Few people have reported birds here this month. A missing species may simply not have been recorded.')
      : null,
    h('h2', {}, 'Species recorded, by month'),
    monthStrip(entry.richness, month, (v) => `${v} species recorded`, handlers.onMonth),
    count === 0 ? h('p', { class: 'muted' }, 'No species to list for this month.') : null,
    ...groups.map((g) => speciesGroup(g.presence, g.species, names, handlers)),
  );
}

function speciesGroup(presence: Presence, species: ReturnType<typeof wildlifeHere>[number]['species'], names: Map<string, SpeciesIndexEntry>, handlers: PanelHandlers): HTMLElement {
  const rows = species.map((s, idx) => {
    const n = names.get(s.key);
    return h('li', { class: `sp-row${idx >= LIST_PREVIEW ? ' is-extra' : ''}` },
      h('button', { class: 'sp-btn', onclick: () => handlers.onSpecies(s.key) },
        h('span', { class: 'sp-name' }, n?.name ?? s.key),
        h('span', { class: 'sp-sci' }, n?.sci ?? ''),
        h('span', { class: 'sp-share', title: 'Share of this month\'s bird records in this square' }, formatShare(s.share))));
  });
  const list = h('ul', { class: 'sp-list' }, ...rows);
  const more = species.length > LIST_PREVIEW
    ? h('button', { class: 'link-btn', onclick: (e: Event) => { list.classList.add('show-all'); (e.currentTarget as HTMLElement).remove(); } }, `Show all ${species.length}`)
    : null;
  return h('div', { class: 'sp-group' }, h('h3', {}, presenceTag(presence), h('span', { class: 'muted' }, ` ${species.length}`)), list, more);
}

export function speciesView(
  sp: SpeciesIndexEntry, range: SpeciesRange, month: Month, meta: Meta,
  wiki: WikiSummary | null | 'loading' | 'error', handlers: PanelHandlers, hasPlace: boolean,
): HTMLElement {
  const perMonth = cellsPerMonth(range.cells);
  const labels = Object.values(range.cells).reduce<Record<Presence, number>>(
    (acc, c) => ({ ...acc, [c.p]: acc[c.p] + 1 }), { resident: 0, seasonal: 0, passage: 0, uncertain: 0 });

  return h('section', { class: 'panel-body' },
    h('div', { class: 'panel-head' },
      h('div', {},
        hasPlace ? h('button', { class: 'link-btn', onclick: handlers.onBackToPlace }, '← Back to place') : null,
        h('h1', { class: 'panel-title' }, sp.name),
        h('p', { class: 'sci' }, sp.sci, sp.family ? h('span', { class: 'muted' }, ` · ${sp.family}`) : null)),
      closeButton(handlers)),
    wikiBlock(wiki),
    h('h2', {}, 'Seasonal world'),
    h('p', { class: 'muted small' }, `Map squares with records in ${MONTH_LONG[month - 1]}: ${perMonth[month - 1]} of ${Object.keys(range.cells).length}. Brighter orange means a larger share of local bird records.`),
    monthStrip(perMonth, month, (v) => `recorded in ${v} squares`, handlers.onMonth),
    h('h2', {}, 'How it uses India'),
    h('ul', { class: 'label-counts' }, ...(Object.keys(labels) as Presence[]).filter((p) => labels[p] > 0)
      .map((p) => h('li', {}, presenceTag(p), ` in ${labels[p]} squares`))),
    h('h2', {}, 'Conservation'),
    h('p', { class: 'muted' }, 'Not available from current sources.'),
    evidenceNote(meta),
  );
}

function wikiBlock(wiki: WikiSummary | null | 'loading' | 'error'): HTMLElement {
  if (wiki === 'loading') return h('p', { class: 'muted' }, 'Loading description…');
  if (wiki === 'error') return h('p', { class: 'muted' }, 'Description unavailable right now.');
  if (!wiki) return h('p', { class: 'muted' }, 'Description not available from current sources.');
  return h('div', { class: 'wiki' },
    wiki.thumbnail ? h('img', { src: wiki.thumbnail, alt: wiki.title, class: 'wiki-img', loading: 'lazy' }) : null,
    h('p', {}, wiki.extract),
    h('p', { class: 'muted small' }, 'Text and image from ', h('a', { href: wiki.pageUrl, target: '_blank', rel: 'noopener' }, 'Wikipedia'), ' (CC BY-SA). Not yet reviewed.'));
}

function evidenceNote(meta: Meta): HTMLElement {
  const s = meta.source;
  return h('details', { class: 'evidence' },
    h('summary', {}, 'Evidence: recorded sightings'),
    h('p', {}, h('strong', {}, 'Source: '), s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.name) : s.name),
    h('p', {}, h('strong', {}, 'Years: '), s.years, ' · ', h('strong', {}, 'Resolution: '), 'monthly, 1° squares'),
    h('p', {}, h('strong', {}, 'Measure: '), meta.measure),
    h('p', { class: 'muted' }, s.note),
    h('p', { class: 'muted small' }, `Built ${new Date(meta.generated).toLocaleDateString()}`));
}

function closeButton(handlers: PanelHandlers): HTMLElement {
  return h('button', { class: 'icon-btn', 'aria-label': 'Close panel', onclick: handlers.onClose }, '✕');
}

export function storyCard(story: Story, step: number, onNext: () => void, onExit: () => void): HTMLElement {
  const s = story.steps[step]!;
  const last = step === story.steps.length - 1;
  return h('div', { class: 'story-card', role: 'dialog', 'aria-label': story.title },
    h('p', { class: 'eyebrow' }, `${story.title} · ${step + 1}/${story.steps.length}`),
    h('p', { class: 'story-month' }, MONTH_LONG[s.month - 1]!),
    h('p', {}, s.text),
    h('div', { class: 'story-actions' },
      h('button', { class: 'chip', onclick: onExit }, 'Exit story'),
      h('button', { class: 'chip chip-primary', onclick: last ? onExit : onNext }, last ? 'Done' : 'Next →')));
}
