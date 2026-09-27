import { MONTH_LONG, MONTH_NAMES } from '../constants';
import type { Story } from '../stories';
import { STORIES } from '../stories';
import type { Meta, SpeciesIndexEntry } from '../types';
import { cellLabel, h, replaceChildren } from './dom';
import { matchSpecies } from './search';

export interface HudHandlers {
  onScrub: (t: number) => void;
  onMonth: (month: number) => void;
  onTogglePlay: () => void;
  onSpecies: (key: string) => void;
  onStory: (story: Story) => void;
  onStoryNext: () => void;
  onStoryExit: () => void;
  onDive: (lng: number, lat: number) => void;
}

export interface Hud {
  setTime(t: number, playing: boolean): void;
  setSpecies(sp: SpeciesIndexEntry | null, presentShare: number): void;
  showStory(story: Story | null, index: number): void;
  showPick(lng: number, lat: number, cellId: string | null, cellSize: number): void;
  setLoading(on: boolean): void;
  fade(on: boolean): void;
}

export function mountHud(root: HTMLElement, meta: Meta, species: SpeciesIndexEntry[], handlers: HudHandlers): Hud {
  const slider = h('input', { type: 'range', min: 0, max: 11.999, step: 0.001, class: 'hud-slider', 'aria-label': 'Time of year' });
  slider.addEventListener('input', () => handlers.onScrub(Number(slider.value)));
  const play = h('button', { class: 'tl-play', 'aria-label': 'Play the year', onclick: handlers.onTogglePlay }, '▶');
  const monthLabel = h('div', { class: 'hud-month', 'aria-live': 'off' });
  const ticks = h('div', { class: 'hud-ticks' }, ...MONTH_NAMES.map((m, i) => h('button', { class: 'hud-tick', onclick: () => handlers.onMonth(i + 1), 'aria-label': MONTH_LONG[i] }, m)));

  const spName = h('h2', { class: 'hud-sp-name' });
  const spSci = h('p', { class: 'hud-sp-sci' });
  const spBar = h('div', { class: 'hud-mass-fill' });
  const input = h('input', { type: 'search', class: 'search-input', placeholder: 'Follow a species…', 'aria-label': 'Follow a species', autocomplete: 'off' });
  const results = h('ul', { class: 'search-results', role: 'listbox' });
  const renderResults = () => {
    const found = matchSpecies(species, input.value);
    replaceChildren(results, ...found.map((s) => h('li', { class: 'search-item', role: 'option', onmousedown: (e: Event) => { e.preventDefault(); input.value = ''; results.classList.remove('is-open'); handlers.onSpecies(s.k); } },
      h('span', {}, s.name, ' ', h('em', { class: 'muted' }, s.sci)))));
    results.classList.toggle('is-open', input.value.trim().length > 0);
  };
  input.addEventListener('input', renderResults);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = matchSpecies(species, input.value)[0]; if (first) { input.value = ''; renderResults(); handlers.onSpecies(first.k); } }
    if (e.key === 'Escape') { input.value = ''; renderResults(); }
  });
  input.addEventListener('blur', () => window.setTimeout(() => results.classList.remove('is-open'), 120));

  const storySlot = h('div', { class: 'story' });
  const pickSlot = h('div', { class: 'hud-pick' });
  const loading = h('div', { class: 'hud-loading', hidden: true }, 'Loading species…');
  const fader = h('div', { class: 'hud-fader' });

  root.append(
    h('div', { class: 'hud-top' },
      h('a', { class: 'brand', href: './' }, 'Wildlife Atlas'),
      h('div', { class: 'search' }, input, results)),
    h('div', { class: 'hud-card' },
      h('p', { class: 'eyebrow' }, 'Following'), spName, spSci,
      h('div', { class: 'hud-mass', title: 'Share of the year\'s peak presence recorded this month' }, spBar),
      h('p', { class: 'hud-note' }, 'Each glowing dot is a share of where this species was recorded, not an individual animal.'),
      h('details', { class: 'hud-stories' }, h('summary', {}, 'Stories'),
        h('ul', { class: 'story-list' }, ...STORIES.map((s) => h('li', {}, h('button', { class: 'story-btn', onclick: () => handlers.onStory(s) }, '▶ ', s.title))))),
      h('p', { class: 'hud-source muted small' }, meta.source.demo ? 'Synthetic demo data' : `Source: ${meta.source.name}`,
        ' · Ranges worldwide, species lists for India')),
    storySlot, pickSlot, loading, fader,
    h('nav', { class: 'hud-timeline', 'aria-label': 'Time of year' }, play, h('div', { class: 'hud-track' }, slider, ticks), monthLabel),
  );

  let lastMonth = -1;
  return {
    setTime(t, playing) {
      slider.value = String(t);
      play.textContent = playing ? '❚❚' : '▶';
      play.setAttribute('aria-label', playing ? 'Pause' : 'Play the year');
      const m = Math.floor(t);
      if (m !== lastMonth) {
        lastMonth = m;
        monthLabel.textContent = MONTH_LONG[m] ?? '';
        ticks.querySelectorAll('.hud-tick').forEach((el, i) => el.classList.toggle('is-active', i === m));
      }
    },
    setSpecies(sp, share) {
      spName.textContent = sp?.name ?? 'No species';
      spSci.textContent = sp?.sci ?? '';
      spBar.style.width = `${Math.round(share * 100)}%`;
    },
    showStory(story, index) {
      if (!story) return replaceChildren(storySlot);
      const step = story.steps[index]!;
      const last = index === story.steps.length - 1;
      replaceChildren(storySlot, h('div', { class: 'story-card', role: 'dialog', 'aria-label': story.title },
        h('p', { class: 'eyebrow' }, `${story.title} · ${index + 1}/${story.steps.length}`),
        h('p', { class: 'story-month' }, MONTH_LONG[step.month - 1]!),
        h('p', {}, step.text),
        h('div', { class: 'story-progress' }, h('span', { style: `animation-duration:7.5s` })),
        h('div', { class: 'story-actions' },
          h('button', { class: 'chip', onclick: handlers.onStoryExit }, 'Exit story'),
          h('button', { class: 'chip chip-primary', onclick: last ? handlers.onStoryExit : handlers.onStoryNext }, last ? 'Done' : 'Next →'))));
    },
    showPick(lng, lat, cellId, cellSize) {
      replaceChildren(pickSlot, h('div', { class: 'pick-card' },
        h('p', { class: 'pick-title' }, cellId ? cellLabel(cellId, cellSize) : `${lat.toFixed(1)}°, ${lng.toFixed(1)}°`),
        cellId ? h('button', { class: 'chip chip-primary', onclick: () => handlers.onDive(lng, lat) }, 'Dive in: see species here →')
          : h('p', { class: 'muted small' }, 'Full species lists cover India for now. Outside India the globe shows featured species\' ranges.'),
        h('button', { class: 'icon-btn pick-close', 'aria-label': 'Close', onclick: () => replaceChildren(pickSlot) }, '✕')));
    },
    setLoading(on) { loading.hidden = !on; },
    fade(on) { fader.classList.toggle('is-on', on); },
  };
}
