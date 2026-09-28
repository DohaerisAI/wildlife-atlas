/**
 * Motion scale from the Living Earth style guide: one mapping per variable, used everywhere,
 * so the same wind looks the same over grass, sand and sea.
 */
export const WIND = {
  /** m/s at which the visual channel tops out */
  maxMs: 15,
  /** style guide: 0-15 m/s -> 0-1.2 cells/s */
  cellsPerS: 1.2,
  /** one cell of the climate grid, in degrees */
  cellDeg: 1,
  /** streak length is the distance travelled in this many seconds */
  streakS: 2.2,
  /** below this speed a streak fades out: calm air shows as calm */
  calmMs: 1.5,
} as const;

/** Globe pack cells more than this % under water count as open water (ripples, bright shoreline). */
export const WATER_THRESHOLD = 50;
/** Snow shows where at least this share of the ground was snow-covered. */
export const SNOW_THRESHOLD = 40;
/** A material channel above this is drawn, and so is captioned with its dataset. */
export const SHOWN = 0.005;
