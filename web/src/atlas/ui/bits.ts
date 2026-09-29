import { MONTH_LONG, MONTH_NAMES } from '../../constants';
import { h } from '../../ui/dom';
import type { Doing } from '../place-summary';

const SVG = 'http://www.w3.org/2000/svg';

/** Twelve bars, Jan..Dec, current month lit. Values are 0..1 (or any scale; normalised to the max). */
export function monthBars(values: readonly number[], current: number, opts: { height?: number; label?: string; labels?: boolean } = {}): HTMLElement {
  const height = opts.height ?? 18;
  const max = Math.max(...values, 0) || 1;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 120 ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  values.forEach((v, i) => {
    const bh = v > 0 ? Math.max(1.5, (v / max) * height) : 1;
    const r = document.createElementNS(SVG, 'rect');
    r.setAttribute('x', String(i * 10 + 1.5));
    r.setAttribute('width', '7');
    r.setAttribute('y', String(height - bh));
    r.setAttribute('height', String(bh));
    r.setAttribute('class', i === current ? 'mb-now' : v > 0 ? 'mb-on' : 'mb-off');
    svg.append(r);
  });
  const wrap = h('div', { class: 'month-bars', role: 'img', 'aria-label': opts.label ?? describeMonths(values) }, svg);
  if (opts.labels) wrap.append(h('div', { class: 'mb-labels', 'aria-hidden': 'true' }, ...MONTH_NAMES.map((m, i) => h('span', { class: i === current ? 'is-now' : '' }, m.charAt(0)))));
  return wrap;
}

/** Screen-reader text for a 12-month strip: which months have any presence. */
export function describeMonths(values: readonly number[]): string {
  const on = values.map((v, i) => (v > 0 ? MONTH_NAMES[i] : null)).filter(Boolean);
  if (on.length === 12) return 'Recorded in every month';
  if (on.length === 0) return 'No records in any month';
  return `Recorded in ${on.join(', ')}`;
}

export const DOING_LABEL: Record<Doing, string> = {
  arriving: 'Arriving', leaving: 'Leaving', staying: 'Visiting', passing: 'Passing through', resident: 'Year-round', recorded: 'Recorded',
};

export const doingTag = (d: Doing) => h('span', { class: `doing doing-${d}` }, DOING_LABEL[d]);

/** A species photo shown whole (never cropped) over a blurred copy of itself; a quiet glyph when missing. */
export function thumb(url: string | null, alt: string, cls = 'thumb'): HTMLElement {
  if (!url) return h('span', { class: `${cls} is-empty`, 'aria-hidden': 'true' });
  const img = h('img', { src: url, alt, loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => { img.remove(); box.classList.add('is-empty'); });
  const box = h('span', { class: cls, style: `--bg:url("${url.replace(/"/g, '%22')}")` }, img);
  return box;
}

export const monthName = (i: number) => MONTH_LONG[((i % 12) + 12) % 12] ?? '';

export function section(title: string, ...children: (Node | string | null | false)[]): HTMLElement {
  return h('section', { class: 'pv-section' }, h('h3', { class: 'pv-h' }, title), ...children);
}

export const notAvailable = (what = 'Not available from current sources') => h('p', { class: 'na' }, what);

export function fmtLat(lat: number): string { return `${Math.abs(lat).toFixed(0)}°${lat >= 0 ? 'N' : 'S'}`; }
export function fmtLng(lng: number): string { return `${Math.abs(lng).toFixed(0)}°${lng >= 0 ? 'E' : 'W'}`; }
