/**
 * Quality tiers chosen from measured frame time (decision 0006), never from device names.
 * Pure reducer: feed it frame durations, it says when to step down or back up.
 */
export type Tier = 'ultra' | 'high' | 'base';

export interface TierSettings {
  readonly pixelRatio: number;
  readonly particles: number;
  readonly landDots: number;
  readonly bloom: boolean;
  /** Living Earth wind streaks */
  readonly windStreaks: number;
  /** material extras: glints, ripples (style guide: off on base) */
  readonly materialFx: boolean;
}

export const TIERS: Readonly<Record<Tier, TierSettings>> = {
  ultra: { pixelRatio: 2, particles: 12000, landDots: 180000, bloom: true, windStreaks: 5000, materialFx: true },
  high: { pixelRatio: 1.5, particles: 8000, landDots: 120000, bloom: true, windStreaks: 3000, materialFx: true },
  base: { pixelRatio: 1, particles: 3000, landDots: 60000, bloom: false, windStreaks: 1200, materialFx: false },
};

const ORDER: readonly Tier[] = ['base', 'high', 'ultra'];
const SLOW_MS = 20; // sustained frames slower than this step down
const FAST_MS = 12; // sustained frames faster than this may step back up
const WINDOW = 60; // frames averaged
const DOWN_AFTER_S = 2;
const UP_AFTER_S = 6;
const COOLDOWN_S = 4;

export interface BudgetState {
  readonly tier: Tier;
  readonly ceiling: Tier;
  readonly samples: readonly number[];
  readonly slowFor: number;
  readonly fastFor: number;
  readonly cooldown: number;
}

export function initialTier(coarsePointer: boolean): Tier {
  return coarsePointer ? 'high' : 'ultra';
}

export function startBudget(tier: Tier): BudgetState {
  return { tier, ceiling: tier, samples: [], slowFor: 0, fastFor: 0, cooldown: COOLDOWN_S };
}

const step = (tier: Tier, by: number): Tier => ORDER[Math.min(ORDER.length - 1, Math.max(0, ORDER.indexOf(tier) + by))]!;

/** Advance the budget by one frame of `frameMs`. Returns the next state; compare `.tier` to detect a change. */
export function sampleFrame(state: BudgetState, frameMs: number): BudgetState {
  const dt = Math.min(frameMs, 250) / 1000;
  const samples = [...state.samples.slice(-(WINDOW - 1)), frameMs];
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const cooldown = Math.max(0, state.cooldown - dt);
  const full = samples.length >= WINDOW;
  const slowFor = full && avg > SLOW_MS ? state.slowFor + dt : 0;
  const fastFor = full && avg < FAST_MS ? state.fastFor + dt : 0;
  const reset = { samples: [] as number[], slowFor: 0, fastFor: 0, cooldown: COOLDOWN_S };

  if (cooldown === 0 && slowFor >= DOWN_AFTER_S && state.tier !== 'base') {
    return { ...state, ...reset, tier: step(state.tier, -1) };
  }
  const canRise = ORDER.indexOf(state.tier) < ORDER.indexOf(state.ceiling);
  if (cooldown === 0 && fastFor >= UP_AFTER_S && canRise) {
    return { ...state, ...reset, tier: step(state.tier, 1) };
  }
  return { ...state, samples, slowFor, fastFor, cooldown };
}
