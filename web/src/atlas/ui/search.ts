import { searchPlaces, type Place as FoundPlace } from '../../external';
import type { SpeciesIndexEntry } from '../../types';
import { h, replaceChildren } from '../../ui/dom';
import { matchSpecies } from '../../ui/search';
import { thumb } from './bits';

export interface SearchHandlers {
  onSpecies(key: string): void;
  onPlace(p: FoundPlace): void;
}

const PLACE_DEBOUNCE_MS = 280;

/** One box for birds and places (spec 3.3): results show a photo, the scientific name and the family. */
export function searchBox(species: SpeciesIndexEntry[], thumbOf: (sci: string) => string | null, handlers: SearchHandlers): HTMLElement {
  const input = h('input', { type: 'search', class: 'search-input', placeholder: 'Search a bird or a place', 'aria-label': 'Search a bird or a place',
    role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'atlas-results', 'aria-autocomplete': 'list', autocomplete: 'off' });
  const list = h('ul', { id: 'atlas-results', class: 'search-results', role: 'listbox' });
  let places: FoundPlace[] = [];
  let active = -1;
  let timer = 0;
  let ctrl: AbortController | null = null;

  const items = () => [...list.querySelectorAll<HTMLElement>('[role="option"]')];
  const close = () => { list.classList.remove('is-open'); input.setAttribute('aria-expanded', 'false'); active = -1; };
  const choose = (fn: () => void) => { input.value = ''; close(); input.blur(); fn(); };

  const render = () => {
    const q = input.value.trim();
    const sp = matchSpecies(species, q);
    const opt = (content: Node[], fn: () => void) => h('li', { role: 'option', class: 'sr-item', onmousedown: (e: Event) => { e.preventDefault(); choose(fn); } }, ...content);
    replaceChildren(list,
      sp.length ? h('li', { class: 'sr-h', role: 'presentation' }, 'Species') : null,
      ...sp.map((s) => opt([thumb(thumbOf(s.sci), s.name, 'thumb sm'), h('span', { class: 'sr-text' }, h('span', { class: 'sr-name' }, s.name || s.sci), h('span', { class: 'sr-sub' }, h('em', {}, s.sci), s.family ? ` · ${s.family}` : '', ` · ${s.cells} cells`))], () => handlers.onSpecies(s.k))),
      places.length ? h('li', { class: 'sr-h', role: 'presentation' }, 'Places') : null,
      ...places.map((p) => opt([h('span', { class: 'thumb sm is-place', 'aria-hidden': 'true' }), h('span', { class: 'sr-text' }, h('span', { class: 'sr-name' }, p.label), h('span', { class: 'sr-sub' }, p.detail))], () => handlers.onPlace(p))));
    const open = q.length > 0 && list.childElementCount > 0;
    list.classList.toggle('is-open', open);
    input.setAttribute('aria-expanded', String(open));
    active = -1;
  };

  input.addEventListener('input', () => {
    places = [];
    render();
    window.clearTimeout(timer);
    ctrl?.abort();
    const q = input.value.trim();
    if (q.length < 3) return;
    timer = window.setTimeout(() => {
      ctrl = new AbortController();
      searchPlaces(q, ctrl.signal).then((found) => { if (input.value.trim() === q) { places = found; render(); } })
        .catch((err) => { if ((err as Error).name !== 'AbortError') console.warn('Place search unavailable', err); });
    }, PLACE_DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    const opts = items();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % Math.max(1, opts.length);
      opts.forEach((o, i) => o.classList.toggle('is-active', i === active));
    } else if (e.key === 'Enter') {
      (opts[Math.max(0, active)])?.dispatchEvent(new Event('mousedown'));
    } else if (e.key === 'Escape') { input.value = ''; close(); }
  });
  input.addEventListener('blur', () => window.setTimeout(close, 120));
  return h('div', { class: 'search' }, input, list);
}
