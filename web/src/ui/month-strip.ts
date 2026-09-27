import { MONTH_LONG, MONTH_NAMES } from '../constants';
import type { Month } from '../types';
import { h } from './dom';

/**
 * Twelve-bar strip: one bar per month, the selected month emphasized.
 * Each bar carries an accessible label and a hover/focus tooltip.
 */
export function monthStrip(values: number[], selected: Month, describe: (v: number) => string, onPick: (m: Month) => void): HTMLElement {
  const max = Math.max(...values, 0) || 1;
  const tip = h('div', { class: 'strip-tip', role: 'status', 'aria-live': 'polite' });
  const bars = values.map((v, i) => {
    const month = (i + 1) as Month;
    const text = `${MONTH_LONG[i]}: ${describe(v)}`;
    const show = () => { tip.textContent = text; };
    return h(
      'button',
      {
        class: `strip-bar${month === selected ? ' is-selected' : ''}`,
        'aria-label': text,
        onclick: () => onPick(month),
        onmouseenter: show,
        onfocus: show,
      },
      h('span', { class: 'strip-fill', style: `height:${Math.max(4, (v / max) * 100)}%${v === 0 ? ';opacity:0.25' : ''}` }),
      h('span', { class: 'strip-label', 'aria-hidden': 'true' }, MONTH_NAMES[i]!.charAt(0)),
    );
  });
  const wrap = h('div', { class: 'strip' }, h('div', { class: 'strip-bars', onmouseleave: () => { tip.textContent = ''; } }, ...bars), tip);
  return wrap;
}
