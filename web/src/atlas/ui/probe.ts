import { className } from '../../engine/living-earth/land-classes';
import { readingLines, readingLinesV2, type EnvReading, type EnvReadingV2 } from '../../engine/living-earth/reading';
import { h, replaceChildren } from '../../ui/dom';
import { fmtLat, fmtLng, monthName } from './bits';

/** Hover card that reads the real values under the pointer ("Tap anything and it says what it is"). */
export function createProbe(): { element: HTMLElement; show(x: number, y: number, lng: number, lat: number, month: number, r: { reading: EnvReading; onLand: boolean; v2: EnvReadingV2 | null } | null): void; hide(): void } {
  const element = h('div', { class: 'probe', role: 'status', 'aria-live': 'off', hidden: true });
  return {
    element,
    show(x, y, lng, lat, month, r) {
      replaceChildren(element,
        h('p', { class: 'pr-head' }, `${fmtLat(lat)} ${fmtLng(lng)} · ${monthName(month)}`),
        ...(r ? [...(r.v2 ? readingLinesV2(r.v2, r.onLand, className) : []), ...readingLines(r.reading, r.onLand)] : []).map((l) => h('p', { class: 'pr-line' }, h('span', { class: 'pr-k' }, l.label), h('span', {}, l.value))),
        h('p', { class: 'pr-foot' }, 'Click for wildlife here'));
      const flip = x > window.innerWidth - 280;
      element.style.transform = `translate(${flip ? x - 256 : x + 18}px, ${Math.min(y + 14, window.innerHeight - 200)}px)`;
      element.hidden = false;
    },
    hide() { element.hidden = true; },
  };
}
