import { MONTH_LONG, MONTH_NAMES } from '../constants';
import type { Month } from '../types';
import { h, replaceChildren } from './dom';

export interface TimelineHandlers {
  onMonth: (m: Month) => void;
  onTogglePlay: () => void;
}

export function renderTimeline(root: HTMLElement, month: Month, playing: boolean, handlers: TimelineHandlers): void {
  const buttons = MONTH_NAMES.map((name, i) => {
    const m = (i + 1) as Month;
    const active = m === month;
    return h('button', {
      class: `tl-month${active ? ' is-active' : ''}`,
      role: 'radio',
      'aria-checked': String(active),
      'aria-label': MONTH_LONG[i],
      tabindex: active ? 0 : -1,
      onclick: () => handlers.onMonth(m),
    }, name);
  });

  const group = h('div', {
    class: 'tl-months', role: 'radiogroup', 'aria-label': 'Month',
    onkeydown: (e: Event) => {
      const key = (e as KeyboardEvent).key;
      const step = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = ((((month - 1 + step) % 12) + 12) % 12 + 1) as Month;
      handlers.onMonth(next);
      requestAnimationFrame(() => root.querySelector<HTMLButtonElement>('.tl-month.is-active')?.focus());
    },
  }, ...buttons);

  replaceChildren(
    root,
    h('button', { class: 'tl-play', 'aria-label': playing ? 'Pause annual cycle' : 'Play annual cycle', onclick: handlers.onTogglePlay }, playing ? '❚❚' : '▶'),
    group,
    h('div', { class: 'tl-caption' }, 'Monthly data'),
  );
}
