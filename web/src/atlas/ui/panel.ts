import { h, replaceChildren } from '../../ui/dom';
import type { PanelView } from '../store';

export interface Panel {
  readonly element: HTMLElement;
  show(view: PanelView, tabs: { place: string | null; species: string | null }, content: HTMLElement): void;
  close(): void;
  isOpen(): boolean;
}

/**
 * Collapsible side panel on desktop, draggable bottom sheet on phones (spec 8).
 * Two tabs: the place you picked and the species you follow.
 */
export function createPanel(onTab: (v: PanelView) => void, onClose: () => void): Panel {
  const tabs = h('div', { class: 'pn-tabs', role: 'tablist' });
  const body = h('div', { class: 'pn-body', role: 'tabpanel', tabindex: -1 });
  const handle = h('button', { class: 'pn-handle', type: 'button', 'aria-label': 'Expand or collapse the panel' });
  const closeBtn = h('button', { class: 'x pn-close', type: 'button', 'aria-label': 'Close panel', onclick: onClose }, '×');
  const element = h('aside', { class: 'panel', 'aria-label': 'Details', hidden: true }, handle, h('div', { class: 'pn-bar' }, tabs, closeBtn), body);

  // sheet: tap the handle to toggle, or drag it
  let startY = 0; let startH = 0; let moved = false;
  handle.addEventListener('pointerdown', (e) => { startY = e.clientY; startH = element.getBoundingClientRect().height; moved = false; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const dy = startY - e.clientY;
    if (Math.abs(dy) > 4) moved = true;
    element.style.height = `${Math.min(window.innerHeight * 0.92, Math.max(120, startH + dy))}px`;
  });
  handle.addEventListener('pointerup', (e) => {
    handle.releasePointerCapture(e.pointerId);
    const hNow = element.getBoundingClientRect().height;
    const expanded = moved ? hNow > window.innerHeight * 0.45 : !element.classList.contains('is-expanded');
    element.style.height = '';
    element.classList.toggle('is-expanded', expanded);
  });

  return {
    element,
    show(view, labels, content) {
      const tab = (v: PanelView, text: string | null) => text
        ? h('button', { class: 'pn-tab', type: 'button', role: 'tab', 'aria-selected': String(v === view), onclick: () => onTab(v) }, text)
        : null;
      replaceChildren(tabs, tab('place', labels.place), tab('species', labels.species));
      const keep = element.hidden ? 0 : body.scrollTop;
      replaceChildren(body, content);
      body.scrollTop = element.dataset.view === view ? keep : 0;
      element.dataset.view = view;
      element.hidden = false;
    },
    close() { element.hidden = true; element.classList.remove('is-expanded'); },
    isOpen: () => !element.hidden,
  };
}
