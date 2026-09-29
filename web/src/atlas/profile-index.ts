import { profileSlug } from '../species/profile';

export interface ProfileEntry { readonly name: string | null; readonly thumb: string | null }
export type ProfileIndex = ReadonlyMap<string, ProfileEntry>;

/** index.json is either a list of slugs (v1) or {slug: {name, sci, thumb}} (v2). */
export function parseProfileIndex(raw: unknown): ProfileIndex {
  if (Array.isArray(raw)) return new Map(raw.filter((s): s is string => typeof s === 'string').map((s) => [s, { name: null, thumb: null }]));
  if (!raw || typeof raw !== 'object') return new Map();
  return new Map(Object.entries(raw as Record<string, { name?: unknown; thumb?: unknown }>).map(([slug, e]) => [slug, {
    name: typeof e?.name === 'string' ? e.name : null,
    thumb: typeof e?.thumb === 'string' ? e.thumb : null,
  }]));
}

export async function loadProfileIndex(): Promise<ProfileIndex> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}content/profiles/index.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseProfileIndex(await res.json());
  } catch (err) {
    console.warn('Profile index unavailable; lists show no photos', err);
    return new Map();
  }
}

export const thumbFor = (index: ProfileIndex, scientific: string): string | null => index.get(profileSlug(scientific))?.thumb ?? null;
export const hasProfile = (index: ProfileIndex, scientific: string): boolean => index.has(profileSlug(scientific));
