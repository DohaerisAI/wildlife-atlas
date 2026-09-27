import { DATA_BASE } from './constants';
import type { CellDetail, CellsIndex, Meta, SpeciesIndexEntry, SpeciesRange } from './types';

export class DataError extends Error {}

const cache = new Map<string, Promise<unknown>>();

async function getJson<T>(path: string): Promise<T> {
  const url = `${DATA_BASE}/${path}`;
  const hit = cache.get(url);
  if (hit) return hit as Promise<T>;
  const request = fetch(url).then(async (res) => {
    if (!res.ok) throw new DataError(`Could not load ${path} (HTTP ${res.status})`);
    return (await res.json()) as T;
  });
  cache.set(url, request);
  request.catch(() => cache.delete(url));
  return request;
}

export const loadMeta = () => getJson<Meta>('meta.json');
export const loadCells = () => getJson<CellsIndex>('cells.json');
export const loadSpeciesIndex = () => getJson<SpeciesIndexEntry[]>('species.json');
export const loadCell = (id: string) => getJson<CellDetail>(`cells/${encodeURIComponent(id)}.json`);
export const loadRange = (key: string) => getJson<SpeciesRange>(`species/${encodeURIComponent(key)}.json`);
