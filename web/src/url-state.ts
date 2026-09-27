import type { Month } from './types';

export interface ViewState {
  month: Month;
  species: string | null;
  cell: string | null;
  camera: { lng: number; lat: number; zoom: number } | null;
}

export function toMonth(value: unknown, fallback: Month): Month {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? (n as Month) : fallback;
}

const SAFE_ID = /^[A-Za-z0-9_.-]{1,64}$/;

export function parseViewState(search: string, fallbackMonth: Month): ViewState {
  const q = new URLSearchParams(search);
  const species = q.get('sp');
  const cell = q.get('cell');
  return {
    month: toMonth(q.get('m'), fallbackMonth),
    species: species && SAFE_ID.test(species) ? species : null,
    cell: cell && SAFE_ID.test(cell) ? cell : null,
    camera: parseCamera(q.get('at')),
  };
}

function parseCamera(value: string | null): ViewState['camera'] {
  if (!value) return null;
  const [lng, lat, zoom] = value.split(',').map(Number);
  const valid = [lng, lat, zoom].every((n) => Number.isFinite(n));
  if (!valid || Math.abs(lat!) > 90 || Math.abs(lng!) > 180 || zoom! < 0 || zoom! > 22) return null;
  return { lng: lng!, lat: lat!, zoom: zoom! };
}

export function serializeViewState(state: ViewState): string {
  const q = new URLSearchParams();
  q.set('m', String(state.month));
  if (state.species) q.set('sp', state.species);
  if (state.cell) q.set('cell', state.cell);
  if (state.camera) {
    const { lng, lat, zoom } = state.camera;
    q.set('at', `${lng.toFixed(3)},${lat.toFixed(3)},${zoom.toFixed(2)}`);
  }
  return `?${q.toString()}`;
}

/** Cell id containing a point, matching the pipeline's south-west-corner ids. */
export function cellIdAt(lng: number, lat: number, size: number): string {
  const snap = (v: number) => Math.floor(v / size) * size;
  const fmt = (v: number) => String(Number(v.toFixed(6)));
  return `${fmt(snap(lat))}_${fmt(snap(lng))}`;
}
