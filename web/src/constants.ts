import type { Presence } from './types';

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const PRESENCE_LABEL: Record<Presence, string> = {
  resident: 'Year-round',
  seasonal: 'Seasonal visitor',
  passage: 'Passing through',
  uncertain: 'Occurrence uncertain',
};

export const PRESENCE_ORDER: Presence[] = ['resident', 'seasonal', 'passage', 'uncertain'];

export const COVERAGE_LABEL = {
  well: 'Well recorded',
  some: 'Some records',
  limited: 'Limited data',
} as const;

export const DATA_BASE = `${import.meta.env.BASE_URL}data`;
export const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';
export const PHOTON_URL = 'https://photon.komoot.io/api/';
export const WIKI_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

export const INITIAL_VIEW = { center: [80, 22] as [number, number], zoom: 2.6 };
export const PLAY_INTERVAL_MS = 1100;
export const LIST_PREVIEW = 12;
