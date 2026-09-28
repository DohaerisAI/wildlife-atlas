import { COVERAGE_LABEL, MONTH_LONG } from '../../constants';
import { loadCell } from '../../data';
import type { CellsIndex, Meta, Month, SpeciesIndexEntry } from '../../types';
import { cellLabel, h, replaceChildren } from '../../ui/dom';
import { matchSpecies } from '../../ui/search';
import { fieldNotes, type NoteStatus } from './field-notes';
import { createYearRing } from './year-ring';

export interface AtlasHudHandlers {
  onScrub(t: number): void;
  onMonth(month: number): void;
  onTogglePlay(): void;
  onToggleFollow(): void;
  onSpecies(key: string): void;
  onDive(lng: number, lat: number): void;
}

export interface AtlasHud {
  setTime(t: number, playing: boolean): void;
  setSpecies(sp: SpeciesIndexEntry | null, presentShare: number): void;
  showPick(lng: number, lat: number, cellId: string | null, cellSize: number): void;
  setLoading(on: boolean): void;
  setFollow(on: boolean): void;
  fade(on: boolean): void;
}

const IDLE_MS = 4000;
const STATUS_LABEL: Record<NoteStatus, string> = {
  arriving: 'Arriving', leaving: 'Leaving', visiting: 'Visiting', passing: 'Passing', resident: 'Resident', recorded: 'Recorded',
};

function searchBox(species: SpeciesIndexEntry[], onPick: (k: string) => void): HTMLElement {
  const input = h('input', { type: 'search', class: 'as-input', placeholder: 'Follow a species', 'aria-label': 'Follow a species', autocomplete: 'off' });
  const results = h('ul', { class: 'as-results', role: 'listbox' });
  const choose = (k: string) => { input.value = ''; render(); input.blur(); onPick(k); };
  const render = () => {
    replaceChildren(results, ...matchSpecies(species, input.value).map((s) => h('li', { class: 'as-item', role: 'option', onmousedown: (e: Event) => { e.preventDefault(); choose(s.k); } },
      h('span', { class: 'as-name' }, s.name), h('span', { class: 'as-sci' }, s.sci))));
    results.classList.toggle('is-open', input.value.trim().length > 0);
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = matchSpecies(species, input.value)[0]; if (first) choose(first.k); }
    if (e.key === 'Escape') { input.value = ''; render(); }
  });
  input.addEventListener('blur', () => window.setTimeout(() => results.classList.remove('is-open'), 120));
  return h('div', { class: 'atlas-search' }, input, results);
}

/** Wakes the chrome on any input and lets it fade when the visitor just watches. */
function idleChrome(): void {
  let timer = 0;
  const wake = () => {
    document.body.classList.remove('is-idle');
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { if (!document.querySelector('.atlas-chrome:focus-within')) document.body.classList.add('is-idle'); }, IDLE_MS);
  };
  ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focusin'].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));
  wake();
}

export function mountAtlasHud(root: HTMLElement, meta: Meta, cells: CellsIndex, species: SpeciesIndexEntry[], handlers: AtlasHudHandlers): AtlasHud {
  const names = new Map(species.map((s) => [s.k, s]));
  const coverage = new Map(cells.cells.map((c) => [c.id, c.coverage]));
  const ring = createYearRing({ onScrub: handlers.onScrub, onMonth: handlers.onMonth });
  const month = h('span', { class: 'atlas-month', 'aria-live': 'off' });

  const spName = h('h1', { class: 'sp-name' });
  const spSci = h('p', { class: 'sp-sci' });
  const spFill = h('i', {});
  const spPct = h('span', { class: 'sp-pct' });
  const play = h('button', { class: 'atlas-btn atlas-play', type: 'button', 'aria-label': 'Play the year', onclick: handlers.onTogglePlay }, 'Play the year');
  const follow = h('button', { class: 'atlas-btn', type: 'button', 'aria-pressed': 'false', onclick: handlers.onToggleFollow, title: 'Keep the camera on the flock while the year plays' }, 'Follow the flock');
  const notes = h('aside', { class: 'field-notes', 'aria-live': 'polite' });
  const loading = h('p', { class: 'atlas-loading', hidden: true }, 'Loading species');
  const fader = h('div', { class: 'atlas-fader' });

  root.append(
    h('header', { class: 'atlas-top atlas-chrome' },
      h('a', { class: 'brand', href: './' }, 'Wildlife Atlas'),
      searchBox(species, handlers.onSpecies), month),
    ring.element,
    h('section', { class: 'atlas-species', 'aria-label': 'Species you are following' },
      h('p', { class: 'kicker' }, 'Following'), spName, spSci,
      h('div', { class: 'sp-share', title: 'Share of the year\'s peak presence recorded this month' }, h('span', { class: 'sp-bar' }, spFill), spPct),
      h('p', { class: 'sp-note' }, 'Each glow is a share of where this species was recorded, not one animal.'),
      h('p', { class: 'sp-source' }, meta.source.demo ? 'Synthetic demo data' : `${meta.source.name}`)),
    h('div', { class: 'atlas-controls atlas-chrome' }, play, follow),
    notes, loading, fader,
  );
  idleChrome();

  let t = 0;
  let pick: { lng: number; lat: number; cellId: string | null; cellSize: number } | null = null;
  let pickToken = 0;

  const renderNotes = async () => {
    if (!pick) return replaceChildren(notes);
    const m = (Math.floor(t) + 1) as Month;
    const { lng, lat, cellId, cellSize } = pick;
    const close = h('button', { class: 'fn-close', type: 'button', 'aria-label': 'Close field notes', onclick: () => { pick = null; replaceChildren(notes); } }, '×');
    const head = [h('p', { class: 'kicker' }, `Field notes · ${MONTH_LONG[m - 1]}`), close];
    if (!cellId) {
      replaceChildren(notes, ...head, h('h2', { class: 'fn-place' }, `${lat.toFixed(1)}°, ${lng.toFixed(1)}°`),
        h('p', { class: 'fn-foot' }, 'Species lists cover India for now. Elsewhere the globe shows featured species\' ranges.'));
      return;
    }
    const token = ++pickToken;
    try {
      const cell = await loadCell(cellId);
      if (token !== pickToken) return;
      const n = fieldNotes(cell, m);
      const cov = coverage.get(cellId)?.[m - 1];
      replaceChildren(notes, ...head, h('h2', { class: 'fn-place' }, cellLabel(cellId, cellSize)),
        n.rows.length ? h('ul', { class: 'fn-list' }, ...n.rows.map((r) => h('li', { class: `fn-row st-${r.status}` },
          h('button', { class: 'fn-sp', type: 'button', onclick: () => handlers.onSpecies(r.key) }, names.get(r.key)?.name ?? r.key),
          h('span', { class: 'fn-st' }, STATUS_LABEL[r.status]))))
          : h('p', { class: 'fn-foot' }, 'No records here this month.'),
        h('p', { class: 'fn-foot' }, `${n.total} species recorded${cov ? ` · ${COVERAGE_LABEL[cov].toLowerCase()}` : ''}`),
        h('button', { class: 'atlas-btn fn-dive', type: 'button', onclick: () => handlers.onDive(lng, lat) }, 'Open the map here'));
    } catch (err) {
      console.warn('Field notes unavailable', cellId, err);
      if (token === pickToken) replaceChildren(notes, ...head, h('p', { class: 'fn-foot' }, 'Field notes for this place could not load.'));
    }
  };

  let lastMonth = -1;
  return {
    setTime(next, playing) {
      t = next;
      ring.set(next);
      play.textContent = playing ? 'Pause' : 'Play the year';
      play.setAttribute('aria-label', playing ? 'Pause' : 'Play the year');
      const m = Math.floor(next);
      if (m !== lastMonth) {
        lastMonth = m;
        month.textContent = MONTH_LONG[m] ?? '';
        if (pick) void renderNotes();
      }
    },
    setSpecies(sp, share) {
      spName.textContent = sp?.name ?? 'No species';
      spSci.textContent = sp?.sci ?? '';
      spFill.style.transform = `scaleX(${share.toFixed(3)})`;
      spPct.textContent = `${Math.round(share * 100)}% of peak`;
    },
    showPick(lng, lat, cellId, cellSize) { pick = { lng, lat, cellId, cellSize }; void renderNotes(); },
    setLoading(on) { loading.hidden = !on; },
    setFollow(on) { follow.classList.toggle('is-on', on); follow.setAttribute('aria-pressed', String(on)); },
    fade(on) { fader.classList.toggle('is-on', on); },
  };
}
