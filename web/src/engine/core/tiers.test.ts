import { describe, expect, it } from 'vitest';
import { initialTier, sampleFrame, startBudget, type BudgetState } from './tiers';

const run = (s: BudgetState, ms: number, frames: number) => {
  let state = s;
  for (let i = 0; i < frames; i++) state = sampleFrame(state, ms);
  return state;
};

describe('quality tiers', () => {
  it('starts phones at high and desktops at ultra', () => {
    expect(initialTier(true)).toBe('high');
    expect(initialTier(false)).toBe('ultra');
  });

  it('holds steady at a good frame rate', () => {
    expect(run(startBudget('ultra'), 16, 600).tier).toBe('ultra');
  });

  it('steps down after sustained slow frames, one tier at a time with a pause between', () => {
    let state = startBudget('ultra');
    const changes: { tier: string; frame: number }[] = [];
    for (let i = 0; i < 800; i++) {
      const next = sampleFrame(state, 30);
      if (next.tier !== state.tier) changes.push({ tier: next.tier, frame: i });
      state = next;
    }
    expect(changes.map((c) => c.tier)).toEqual(['high', 'base']);
    // at 30 ms a frame, at least ~4 s (cooldown) separate the two steps
    expect((changes[1]!.frame - changes[0]!.frame) * 30).toBeGreaterThanOrEqual(4000);
  });

  it('ignores a short stutter', () => {
    const s = run(run(startBudget('ultra'), 16, 300), 40, 20);
    expect(run(s, 16, 100).tier).toBe('ultra');
  });

  it('climbs back up with headroom but never above the starting ceiling', () => {
    const down = run(startBudget('high'), 30, 400);
    expect(down.tier).toBe('base');
    const up = run(down, 8, 1200);
    expect(up.tier).toBe('high');
    expect(run(up, 8, 1200).tier).toBe('high');
  });

  it('does not mutate the previous state', () => {
    const s = startBudget('ultra');
    sampleFrame(s, 16);
    expect(s.samples).toHaveLength(0);
  });
});
