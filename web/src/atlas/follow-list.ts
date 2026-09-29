/**
 * Species on the globe at once. Animals get colours the environment never uses (style guide: amber is
 * reserved for animals; rose and violet join it so up to three species can be compared).
 */
export const ANIMAL_COLORS = ['#ffb26b', '#ff6fa3', '#b69cff'] as const;
export const MAX_FOLLOWED = ANIMAL_COLORS.length;

export interface Followed { readonly key: string; readonly color: string }

/** Put a species first (the one the panel shows); keep colours stable; drop the oldest past the limit. */
export function follow(list: readonly Followed[], key: string): Followed[] {
  const existing = list.find((f) => f.key === key);
  if (existing) return [existing, ...list.filter((f) => f.key !== key)];
  const kept = list.slice(0, MAX_FOLLOWED - 1);
  const used = new Set(kept.map((f) => f.color));
  const color = ANIMAL_COLORS.find((c) => !used.has(c)) ?? ANIMAL_COLORS[0];
  return [{ key, color }, ...kept];
}

export function unfollow(list: readonly Followed[], key: string): Followed[] {
  return list.filter((f) => f.key !== key);
}
