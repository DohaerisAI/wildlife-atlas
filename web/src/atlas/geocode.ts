import { PHOTON_URL } from '../constants';

export interface PlaceName { readonly name: string; readonly detail: string }

/** Photon feature properties to a short name ("Wokha") and context ("Nagaland, India"). */
export function placeNameFrom(props: Record<string, unknown> | undefined): PlaceName | null {
  if (!props) return null;
  const str = (k: string) => (typeof props[k] === 'string' ? (props[k] as string) : '');
  const name = str('city') || str('town') || str('village') || str('county') || str('district') || str('name') || str('state');
  if (!name) return null;
  const detail = [str('state'), str('country')].filter((x) => x && x !== name).join(', ');
  return { name, detail };
}

const REVERSE_URL = PHOTON_URL.replace(/api\/?$/, 'reverse');
const cache = new Map<string, Promise<PlaceName | null>>();

/** Name of the nearest place; cached per ~10 km. Null over open sea or when the service is unreachable. */
export function reversePlace(lng: number, lat: number): Promise<PlaceName | null> {
  const key = `${lat.toFixed(1)},${lng.toFixed(1)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const req = fetch(`${REVERSE_URL}?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&lang=en&limit=1`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`reverse geocode HTTP ${res.status}`);
      const body = await res.json();
      return placeNameFrom(body?.features?.[0]?.properties);
    })
    .catch((err) => { console.warn('Place name unavailable', err); cache.delete(key); return null; });
  cache.set(key, req);
  return req;
}
