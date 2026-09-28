import type { ViewKind } from '../scene/view';
import { h, replaceChildren } from './dom';

const VIEWS: { kind: ViewKind; label: string; hint: string }[] = [
  { kind: 'holo', label: 'Hologram', hint: 'Stylized globe with animated flows' },
  { kind: 'real', label: 'Realistic', hint: 'Satellite Earth with sunlight and terrain' },
  { kind: 'map', label: 'Map', hint: 'Detailed map with species lists' },
];

/** Shared state carried between views in the URL. */
export interface CarryState {
  month: number;
  species: string | null;
  cell?: string | null;
  at?: { lng: number; lat: number; zoom: number } | null;
  dive?: boolean;
}

export function viewUrl(kind: ViewKind, s: CarryState): string {
  const q = new URLSearchParams();
  if (kind !== 'map') q.set('view', kind);
  q.set('m', String(s.month));
  if (s.species) q.set('sp', s.species);
  if (s.cell) q.set('cell', s.cell);
  if (s.at) q.set('at', `${s.at.lng.toFixed(3)},${s.at.lat.toFixed(3)},${s.at.zoom.toFixed(2)}`);
  if (s.dive) q.set('dive', '1');
  return `${kind === 'map' ? 'map.html' : 'atlas.html'}?${q.toString()}`;
}

export function renderViewSwitch(root: HTMLElement, current: ViewKind, carry: () => CarryState): void {
  replaceChildren(root, h('div', { class: 'view-switch', role: 'group', 'aria-label': 'View style' },
    ...VIEWS.map((v) => h('button', {
      class: `vs-btn${v.kind === current ? ' is-active' : ''}`, title: v.hint, 'aria-pressed': String(v.kind === current),
      onclick: () => { if (v.kind !== current) location.href = viewUrl(v.kind, carry()); },
    }, v.label))));
}
