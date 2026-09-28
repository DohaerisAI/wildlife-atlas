/** Fixed drawing order from the Living Earth style guide. Higher draws later (on top). */
export const LAYER_ORDER = {
  ocean: 1,
  land: 2,
  relief: 3,
  water: 4,
  vegetation: 5,
  snow: 6,
  atmosphere: 7,
  animals: 8,
  individuals: 9,
} as const;
