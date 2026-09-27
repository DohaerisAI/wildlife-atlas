import { LEGENDS } from '../layers';
import { h, replaceChildren } from './dom';

export function renderLegend(root: HTMLElement, mode: 'richness' | 'species', max: number, speciesName: string | null): void {
  const colors = LEGENDS[mode];
  const title = mode === 'species' ? `${speciesName}: share of local bird records` : 'Bird species recorded this month';
  const [lo, hi] = mode === 'species' ? ['low', 'its peak'] : ['0', String(max)];
  replaceChildren(root,
    h('p', { class: 'legend-title' }, title),
    h('div', { class: 'legend-ramp', style: `background:linear-gradient(90deg,${colors.join(',')})`, role: 'img', 'aria-label': `Colour scale from ${lo} to ${hi}` }),
    h('div', { class: 'legend-ends' }, h('span', {}, lo), h('span', {}, hi)),
    h('p', { class: 'legend-note' }, 'Recorded sightings, not population. Empty areas may just lack observers.'));
}
