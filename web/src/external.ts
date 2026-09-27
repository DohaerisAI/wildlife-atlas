import { PHOTON_URL, WIKI_SUMMARY_URL } from './constants';

export interface WikiSummary {
  title: string;
  extract: string;
  thumbnail: string | null;
  pageUrl: string;
}

export async function wikiSummary(scientificName: string, signal?: AbortSignal): Promise<WikiSummary | null> {
  const title = encodeURIComponent(scientificName.replace(/ /g, '_'));
  const res = await fetch(`${WIKI_SUMMARY_URL}${title}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Wikipedia returned HTTP ${res.status}`);
  const body = await res.json();
  if (body.type === 'disambiguation') return null;
  return {
    title: String(body.title ?? scientificName),
    extract: String(body.extract ?? ''),
    thumbnail: typeof body.thumbnail?.source === 'string' ? body.thumbnail.source : null,
    pageUrl: String(body.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${title}`),
  };
}

export interface Place {
  label: string;
  detail: string;
  lng: number;
  lat: number;
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=5&lang=en`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Place search returned HTTP ${res.status}`);
  const body = await res.json();
  const features: unknown[] = Array.isArray(body?.features) ? body.features : [];
  return features.flatMap((f: any) => {
    const [lng, lat] = f?.geometry?.coordinates ?? [];
    if (typeof lng !== 'number' || typeof lat !== 'number') return [];
    const p = f.properties ?? {};
    const detail = [p.state, p.country].filter(Boolean).join(', ');
    return [{ label: String(p.name ?? query), detail, lng, lat }];
  });
}
