import { h } from '../../ui/dom';

/** Every colour and motion on the globe, what it means and where it comes from (spec 8, "Real" law). */
export const LEGEND: readonly { swatch: string; name: string; meaning: string; source: string }[] = [
  { swatch: 'animal', name: 'Species glow', meaning: 'Share of where the followed species was recorded this month, not individual animals', source: 'GBIF occurrence records' },
  { swatch: 'water', name: 'Surface water', meaning: 'Brighter where more of the area is under water in this month', source: 'JRC Global Surface Water' },
  { swatch: 'snow', name: 'Snow', meaning: 'Where at least 40 % of the ground is snow-covered', source: 'MODIS, 2015–2024 mean' },
  { swatch: 'wind', name: 'Wind streaks', meaning: 'Direction and speed of the monthly mean wind at 10 m', source: 'ERA5, 1991–2020 mean' },
  { swatch: 'forest', name: 'Forest dots', meaning: 'Tree cover; brighter where the canopy is dense and green this month, dimmer in the dry season', source: 'ESA WorldCover · MODIS tree cover and NDVI' },
  { swatch: 'grass', name: 'Grass and crop dots', meaning: 'Brighten with the green-up, fade as they dry', source: 'ESA WorldCover · MODIS NDVI' },
  { swatch: 'desert', name: 'Sand dots', meaning: 'Bare ground and sparse vegetation', source: 'ESA WorldCover' },
  { swatch: 'relief', name: 'Relief', meaning: 'Mountains lit from the north-west, exaggerated so they read from space', source: 'NOAA ETOPO1' },
  { swatch: 'current', name: 'Current streaks', meaning: 'Surface ocean currents; speed and direction of the monthly mean', source: 'HYCOM, 2015–2024' },
  { swatch: 'bloom', name: 'Plankton glow', meaning: 'Brighter where chlorophyll is high: where the ocean blooms', source: 'MODIS-Aqua, 2015–2024' },
  { swatch: 'lights', name: 'City lights', meaning: 'Night-time light, shown only on the night side of today\'s sun', source: 'VIIRS, 2022–2024' },
];

export function legendPanel(onClose: () => void): HTMLElement {
  return h('aside', { class: 'legend', 'aria-label': 'What you are seeing' },
    h('header', { class: 'lg-head' }, h('p', { class: 'kicker' }, 'What you are seeing'), h('button', { class: 'x', type: 'button', 'aria-label': 'Close', onclick: onClose }, '×')),
    h('ul', {}, ...LEGEND.map((l) => h('li', {}, h('span', { class: `sw sw-${l.swatch}`, 'aria-hidden': 'true' }),
      h('span', {}, h('strong', {}, l.name), h('span', { class: 'lg-meaning' }, l.meaning), h('span', { class: 'lg-src' }, l.source))))),
    h('p', { class: 'legend-note' }, 'Every moving or coloured thing is bound to a named dataset and month. Hover the globe to read the values.'));
}
