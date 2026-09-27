import { searchPlaces, type Place } from '../external';
import type { SpeciesIndexEntry } from '../types';
import { h, replaceChildren } from './dom';

export interface SearchHandlers {
  onSpecies: (key: string) => void;
  onPlace: (place: Place) => void;
}

type Result = { kind: 'species'; entry: SpeciesIndexEntry } | { kind: 'place'; place: Place };

const PLACE_DEBOUNCE_MS = 300;
const MAX_SPECIES = 6;

export function matchSpecies(index: SpeciesIndexEntry[], query: string): SpeciesIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (s: SpeciesIndexEntry) => {
    const name = s.name.toLowerCase();
    const sci = s.sci.toLowerCase();
    if (name.startsWith(q) || sci.startsWith(q)) return 0;
    if (name.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    return name.includes(q) || sci.includes(q) ? 2 : 3;
  };
  return index
    .map((s) => ({ s, rank: score(s) }))
    .filter((x) => x.rank < 3)
    .sort((a, b) => a.rank - b.rank || b.s.cells - a.s.cells)
    .slice(0, MAX_SPECIES)
    .map((x) => x.s);
}

export function mountSearch(root: HTMLElement, index: SpeciesIndexEntry[], handlers: SearchHandlers): void {
  const input = h('input', {
    type: 'search', class: 'search-input', placeholder: 'Search a bird or a place', 'aria-label': 'Search a bird or a place',
    role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'search-results', autocomplete: 'off',
  });
  const list = h('ul', { id: 'search-results', class: 'search-results', role: 'listbox' });
  root.append(input, list);

  let results: Result[] = [];
  let places: Place[] = [];
  let active = -1;
  let timer: number | undefined;
  let controller: AbortController | null = null;
  let placeStatus = '';

  const choose = (r: Result) => {
    input.value = '';
    close();
    if (r.kind === 'species') handlers.onSpecies(r.entry.k);
    else handlers.onPlace(r.place);
  };

  const render = () => {
    const species = matchSpecies(index, input.value).map((entry): Result => ({ kind: 'species', entry }));
    results = [...species, ...places.map((place): Result => ({ kind: 'place', place }))];
    const items = results.map((r, i) => h('li', {
      role: 'option', id: `sr-${i}`, class: `search-item${i === active ? ' is-active' : ''}`, 'aria-selected': String(i === active),
      onmousedown: (e: Event) => { e.preventDefault(); choose(r); },
    },
    h('span', { class: `search-kind search-kind-${r.kind}` }, r.kind === 'species' ? 'Bird' : 'Place'),
    r.kind === 'species'
      ? h('span', {}, r.entry.name, ' ', h('em', { class: 'muted' }, r.entry.sci))
      : h('span', {}, r.place.label, ' ', h('span', { class: 'muted' }, r.place.detail))));
    const empty = input.value.trim().length > 0 && results.length === 0;
    replaceChildren(list, ...items, placeStatus ? h('li', { class: 'search-status' }, placeStatus) : null,
      empty && !placeStatus ? h('li', { class: 'search-status' }, 'No matching birds or places') : null);
    const open = input.value.trim().length > 0;
    input.setAttribute('aria-expanded', String(open));
    list.classList.toggle('is-open', open);
    if (active >= 0) input.setAttribute('aria-activedescendant', `sr-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const close = () => { places = []; active = -1; placeStatus = ''; render(); };

  const lookupPlaces = (q: string) => {
    controller?.abort();
    if (q.length < 3) { places = []; placeStatus = ''; render(); return; }
    controller = new AbortController();
    placeStatus = 'Searching places…';
    render();
    searchPlaces(q, controller.signal)
      .then((found) => { places = found; placeStatus = ''; render(); })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        console.error('Place search failed', err);
        places = []; placeStatus = 'Place search is unavailable right now'; render();
      });
  };

  input.addEventListener('input', () => {
    active = -1;
    render();
    window.clearTimeout(timer);
    timer = window.setTimeout(() => lookupPlaces(input.value.trim()), PLACE_DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(results.length - 1, active + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(-1, active - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { const r = results[active] ?? results[0]; if (r) choose(r); }
    else if (e.key === 'Escape') { input.value = ''; close(); }
  });
  input.addEventListener('blur', () => window.setTimeout(() => list.classList.remove('is-open'), 100));
}
