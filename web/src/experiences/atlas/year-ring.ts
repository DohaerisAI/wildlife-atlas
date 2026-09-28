import { MONTH_LONG, MONTH_NAMES } from '../../constants';
import { pointToTime, ringPoint } from './ring-math';

const SVG = 'http://www.w3.org/2000/svg';
const VIEW = 1000;
const C = VIEW / 2;
const R = 470;
const KEY_STEP = 1 / 30; // about a day
const PAGE_STEP = 1;

/** Seasons as India's naturalists read them; the ring is tinted, never labelled with them. */
const SEASONS: readonly { from: number; to: number; tone: string }[] = [
  { from: -1, to: 2, tone: 'var(--snow)' }, // winter
  { from: 2, to: 5, tone: 'var(--grass)' }, // spring and pre-monsoon
  { from: 5, to: 9, tone: 'var(--water)' }, // monsoon
  { from: 9, to: 11, tone: 'var(--life)' }, // post-monsoon
];

export interface YearRingHandlers {
  onScrub(t: number): void;
  onMonth(month: number): void;
}

export interface YearRing {
  readonly element: HTMLElement;
  set(t: number): void;
}

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
  const node = document.createElementNS(SVG, tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
  return node;
};

function arc(from: number, to: number, r: number): string {
  const [x0, y0] = ringPoint(from, r, C, C);
  const [x1, y1] = ringPoint(to, r, C, C);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > 6 ? 1 : 0} 1 ${x1} ${y1}`;
}

/** The year as a ring you turn around the globe (design direction, Act IV). */
export function createYearRing(handlers: YearRingHandlers): YearRing {
  const root = document.createElement('div');
  root.className = 'year-ring';
  const svg = el('svg', { viewBox: `0 0 ${VIEW} ${VIEW}`, 'aria-hidden': 'true' });
  svg.append(el('circle', { cx: C, cy: C, r: R, class: 'yr-track' }));
  SEASONS.forEach((s) => {
    const p = el('path', { d: arc(s.from + 0.08, s.to - 0.08, R), class: 'yr-season' });
    p.style.stroke = s.tone;
    svg.append(p);
  });
  for (let m = 0; m < 12; m++) {
    const [x0, y0] = ringPoint(m, R - 14, C, C);
    const [x1, y1] = ringPoint(m, R + 14, C, C);
    svg.append(el('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'yr-tick' }));
  }
  const progress = el('path', { d: '', class: 'yr-progress' });
  const knob = el('circle', { cx: C, cy: C - R, r: 11, class: 'yr-knob' });
  // only the band of the ring takes the pointer; the globe inside stays draggable
  const hit = el('circle', { cx: C, cy: C, r: R, class: 'yr-hit' });
  svg.append(progress, knob, hit);

  const labels = MONTH_NAMES.map((name, m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'yr-month';
    b.textContent = name;
    b.setAttribute('aria-label', MONTH_LONG[m]!);
    const [x, y] = ringPoint(m + 0.5, R + 40, C, C);
    b.style.left = `${(x / VIEW) * 100}%`;
    b.style.top = `${(y / VIEW) * 100}%`;
    b.addEventListener('click', () => handlers.onMonth(m + 1));
    return b;
  });

  const dial = document.createElement('div');
  dial.className = 'yr-dial';
  dial.tabIndex = 0;
  dial.setAttribute('role', 'slider');
  dial.setAttribute('aria-label', 'Time of year: drag the ring or use the arrow keys');
  dial.setAttribute('aria-valuemin', '0');
  dial.setAttribute('aria-valuemax', '12');
  dial.append(svg);
  root.append(dial, ...labels);

  let t = 0;
  const scrubFrom = (e: PointerEvent) => {
    const rect = dial.getBoundingClientRect();
    handlers.onScrub(pointToTime(e.clientX, e.clientY, rect.left + rect.width / 2, rect.top + rect.height / 2));
  };
  let dragging = false;
  hit.addEventListener('pointerdown', (e) => {
    dragging = true;
    hit.setPointerCapture(e.pointerId);
    root.classList.add('is-turning');
    scrubFrom(e);
  });
  hit.addEventListener('pointermove', (e) => { if (dragging) scrubFrom(e); });
  const end = () => { dragging = false; root.classList.remove('is-turning'); };
  hit.addEventListener('pointerup', end);
  hit.addEventListener('pointercancel', end);
  dial.addEventListener('keydown', (e) => {
    const step = e.key === 'PageUp' || e.key === 'PageDown' ? PAGE_STEP : KEY_STEP;
    const dir = ['ArrowRight', 'ArrowUp', 'PageUp'].includes(e.key) ? 1 : ['ArrowLeft', 'ArrowDown', 'PageDown'].includes(e.key) ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    handlers.onScrub((((t + dir * step) % 12) + 12) % 12);
  });

  let lastMonth = -1;
  return {
    element: root,
    set(next) {
      t = next;
      const [x, y] = ringPoint(t, R, C, C);
      knob.setAttribute('cx', String(x));
      knob.setAttribute('cy', String(y));
      progress.setAttribute('d', t > 0.02 ? arc(0, Math.min(t, 11.999), R) : '');
      dial.setAttribute('aria-valuenow', t.toFixed(2));
      const m = Math.floor(t);
      if (m !== lastMonth) {
        lastMonth = m;
        dial.setAttribute('aria-valuetext', MONTH_LONG[m] ?? '');
        labels.forEach((b, i) => b.classList.toggle('is-active', i === m));
      }
    },
  };
}
