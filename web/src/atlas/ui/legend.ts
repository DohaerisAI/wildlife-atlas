import type { Meta } from '../../types';
import { h } from '../../ui/dom';

/** Every colour and motion on the globe, what it means and where it comes from (spec 8, "Real" law). */
export const LEGEND: readonly { swatch: string; name: string; meaning: string; source: string }[] = [
  { swatch: 'animal', name: 'Species glow', meaning: 'Share of where a followed species was recorded this month, not individual animals. Up to three at once, each in its own colour (amber, rose, violet); the ground never uses these.', source: 'GBIF occurrence records' },
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

const METHODS: readonly [string, string][] = [
  ['Species glow and lists', 'GBIF occurrence records (mostly eBird and iNaturalist) counted per 1° grid cell and calendar month, all years combined. A species\' rate is its share of the cell\'s bird records that month, so it reflects reporting as well as birds.'],
  ['Year-round, seasonal, passage', 'Classified per cell from the shape of the 12-month record pattern; months marked present drive "arriving" and "leaving".'],
  ['Coverage', 'Well recorded, some records or limited data, from the number of records in the cell and month.'],
  ['Environment', 'Monthly climatologies from Earth Engine (water, snow, greenness, wind, temperature, currents, chlorophyll) and static land cover, relief and night lights. Each value on screen names its dataset.'],
  ['Photos and facts', 'Wikidata, Wikipedia and Wikimedia Commons. Each photo shows its author and licence.'],
];

export function legendPanel(onClose: () => void, meta?: Meta, packAttribution?: string): HTMLElement {
  return h('aside', { class: 'legend', 'aria-label': 'What you are seeing' },
    h('header', { class: 'lg-head' }, h('p', { class: 'kicker' }, 'What you are seeing'), h('button', { class: 'x', type: 'button', 'aria-label': 'Close', onclick: onClose }, '×')),
    h('ul', {}, ...LEGEND.map((l) => h('li', {}, h('span', { class: `sw sw-${l.swatch}`, 'aria-hidden': 'true' }),
      h('span', {}, h('strong', {}, l.name), h('span', { class: 'lg-meaning' }, l.meaning), h('span', { class: 'lg-src' }, l.source))))),
    h('p', { class: 'legend-note' }, 'Every moving or coloured thing is bound to a named dataset and month. Hover the globe to read the values.'),
    h('h3', { class: 'pv-h lg-sub' }, 'Data and methods'),
    h('dl', { class: 'lg-methods' }, ...METHODS.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))),
    meta ? h('p', { class: 'lg-src' }, `Species data: ${meta.source.name}, ${meta.source.years}; generated ${meta.generated.slice(0, 10)}. `, h('a', { href: meta.source.url, target: '_blank', rel: 'noopener' }, 'Source query on GBIF')) : null,
    packAttribution ? h('p', { class: 'lg-src' }, `Environment: ${packAttribution}`) : null,
    h('p', { class: 'lg-src' }, 'Downloads: open a place or species and use "For researchers". Code and pipeline: ', h('a', { href: 'https://github.com/DohaerisAI/wildlife-atlas', target: '_blank', rel: 'noopener' }, 'github.com/DohaerisAI/wildlife-atlas'), '.'));
}
