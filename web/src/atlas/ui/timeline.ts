import { MONTH_LONG, MONTH_NAMES } from '../../constants';
import { h } from '../../ui/dom';

export interface TimelineHandlers {
  onScrub(t: number): void;
  onMonth(month: number): void;
  onTogglePlay(): void;
  /** step one month back (-1) or forward (+1), landing mid-month */
  onStep(dir: -1 | 1): void;
  onToday(): void;
}

export interface Timeline {
  readonly element: HTMLElement;
  set(t: number, playing: boolean): void;
  /** the followed species' presence per month (0..1), drawn as the curve behind the months */
  setCurve(values: readonly number[] | null, label: string): void;
}

const SVG = 'http://www.w3.org/2000/svg';

/** Month control along the bottom (spec 3.2 / 8): the date is always visible, the season is drawn behind it. */
/** Today as a year position (months, 0 = 1 Jan). */
export function todayT(d = new Date()): number {
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getMonth() + (d.getDate() - 0.5) / days;
}

export function createTimeline(handlers: TimelineHandlers): Timeline {
  const play = h('button', { class: 'tl-play', type: 'button', 'aria-label': 'Play the year', onclick: handlers.onTogglePlay });
  const date = h('p', { class: 'tl-date', 'aria-live': 'polite' });
  const prev = h('button', { class: 'tl-step', type: 'button', 'aria-label': 'Previous month', onclick: () => handlers.onStep(-1) }, '‹');
  const next = h('button', { class: 'tl-step', type: 'button', 'aria-label': 'Next month', onclick: () => handlers.onStep(1) }, '›');
  const today = h('button', { class: 'tl-today', type: 'button', onclick: handlers.onToday, title: 'Back to this month' }, 'Today');
  const res = h('span', { class: 'tl-res', title: 'The data are monthly: values change month to month, not day to day' }, 'Monthly data');
  const curveLabel = h('p', { class: 'tl-curve-label' });
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 1200 60');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const area = document.createElementNS(SVG, 'path');
  area.setAttribute('class', 'tl-area');
  svg.append(area);
  const months = h('div', { class: 'tl-months' }, ...MONTH_NAMES.map((m, i) => h('button', { type: 'button', class: 'tl-month', 'aria-label': MONTH_LONG[i], onclick: () => handlers.onMonth(i + 1) },
    h('span', { class: 'long' }, m), h('span', { class: 'short', 'aria-hidden': 'true' }, m.charAt(0)))));
  const head = h('span', { class: 'tl-head' });
  const now = h('span', { class: 'tl-now', title: 'Today', style: `left:${(todayT() / 12) * 100}%` });
  const track = h('div', { class: 'tl-track', role: 'slider', tabindex: 0, 'aria-label': 'Time of year', 'aria-valuemin': 0, 'aria-valuemax': 12 }, svg, now, head);
  const element = h('nav', { class: 'timeline', 'aria-label': 'Time of year' }, play, h('div', { class: 'tl-body' }, h('div', { class: 'tl-top' }, prev, date, next, today, res, curveLabel), track, months));

  let t = 0;
  let dragging = false;
  const scrub = (e: PointerEvent) => {
    const r = track.getBoundingClientRect();
    handlers.onScrub(Math.min(11.999, Math.max(0, ((e.clientX - r.left) / r.width) * 12)));
  };
  track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); scrub(e); });
  track.addEventListener('pointermove', (e) => { if (dragging) scrub(e); });
  track.addEventListener('pointerup', () => { dragging = false; });
  track.addEventListener('pointercancel', () => { dragging = false; });
  track.addEventListener('keydown', (e) => {
    const step = e.key === 'PageUp' || e.key === 'PageDown' ? 1 : 1 / 30;
    const dir = ['ArrowRight', 'ArrowUp', 'PageUp'].includes(e.key) ? 1 : ['ArrowLeft', 'ArrowDown', 'PageDown'].includes(e.key) ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    handlers.onScrub((((t + dir * step) % 12) + 12) % 12);
  });

  let lastMonth = -1;
  return {
    element,
    set(next, playing) {
      t = next;
      head.style.left = `${(next / 12) * 100}%`;
      track.setAttribute('aria-valuenow', next.toFixed(2));
      play.classList.toggle('is-playing', playing);
      play.setAttribute('aria-label', playing ? 'Pause' : 'Play the year');
      const m = Math.floor(next);
      if (m !== lastMonth) {
        lastMonth = m;
        const day = Math.min(28, Math.floor((next - m) * 30) + 1);
        date.textContent = MONTH_LONG[m] ?? '';
        today.hidden = m === new Date().getMonth();
        track.setAttribute('aria-valuetext', `${day} ${MONTH_LONG[m]}`);
        months.querySelectorAll('.tl-month').forEach((b, i) => b.classList.toggle('is-now', i === m));
      }
    },
    setCurve(values, label) {
      curveLabel.textContent = label;
      if (!values) { area.setAttribute('d', ''); return; }
      const max = Math.max(...values, 0) || 1;
      // mid-month anchors, wrapped at both ends so the curve reads as a cycle
      const pts = [-1, ...values.keys(), 12].map((i) => {
        const v = values[((i % 12) + 12) % 12]! / max;
        return [(i + 0.5) * 100, 58 - v * 50] as const;
      });
      const d = pts.map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)).join(' ');
      area.setAttribute('d', `${d} L 1250 60 L -50 60 Z`);
    },
  };
}
