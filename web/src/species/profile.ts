/** Species profile content (L2 product) built by `atlas profiles` from Wikidata, Wikipedia and Commons. */
export interface Range { readonly min: number; readonly max: number; readonly unit: 'cm' | 'g' }
export interface ProfileImage { readonly url: string; readonly thumb?: string; readonly page: string; readonly license: string; readonly artist: string; readonly caption: string }
export interface Taxon { readonly scientific: string; readonly name?: string }
export interface SpeciesProfile {
  readonly scientific: string;
  readonly name: string;
  readonly qid: string;
  readonly description: string;
  readonly extract: string;
  readonly images: readonly ProfileImage[];
  readonly facts: { readonly wingspan?: Range; readonly length?: Range; readonly mass?: Range; readonly status?: { readonly code: string; readonly label: string } };
  readonly sources: readonly { readonly label: string; readonly url: string }[];
  readonly licence_note: string;
  readonly taxonomy?: { readonly genus?: Taxon; readonly family?: Taxon; readonly order?: Taxon; readonly class?: Taxon };
  readonly other_names?: readonly string[];
}

export const profileSlug = (scientific: string) => scientific.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function loadProfile(scientific: string): Promise<SpeciesProfile | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}content/profiles/${profileSlug(scientific)}.json`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Profile for ${scientific} failed to load (HTTP ${res.status})`);
  return (await res.json()) as SpeciesProfile;
}

export function formatRange(r: Range): string {
  const f = (v: number) => (v >= 1000 && r.unit === 'g' ? `${(v / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg` : `${Math.round(v).toLocaleString('en-IN')} ${r.unit}`);
  if (r.min === r.max) return f(r.min);
  if (r.unit === 'g' && r.max >= 1000) return `${f(r.min)} – ${f(r.max)}`;
  return `${Math.round(r.min).toLocaleString('en-IN')}–${f(r.max)}`;
}

/** Everyday objects for weight, lightest first. Grams. */
const WEIGHTS: readonly [string, number][] = [
  ['a coin', 5], ['a pencil', 8], ['a sparrow', 30], ['a cricket ball', 160], ['a mango', 300], ['a litre of milk', 1030],
  ['a bag of rice', 5000], ['a person', 65000], ['a car', 1300000], ['an elephant', 4000000],
];

/** "Lighter than a cricket ball" style comparison for a species' weight range. */
export function weightComparison(mass: Range | undefined): string {
  if (!mass || mass.unit !== 'g') return '';
  const heavier = WEIGHTS.find(([, g]) => g > mass.max);
  const lighter = [...WEIGHTS].reverse().find(([, g]) => g < mass.min);
  if (heavier && heavier[1] <= mass.max * 3) return `Lighter than ${heavier[0]}`;
  if (lighter) return `Heavier than ${lighter[0]}`;
  return '';
}
