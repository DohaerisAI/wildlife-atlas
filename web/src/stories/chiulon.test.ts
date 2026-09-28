import { describe, expect, it } from 'vitest';
import { MATERIAL_CHANNELS } from '../engine/living-earth/materials';
import { stateAt } from '../story/interpolate';
import { CHIULON, CHIULON_PATH, CHIULON_ROUTE } from './chiulon';

describe('Chiulon story data', () => {
  it('is a valid story with the cold open first and the atlas handoff last', () => {
    expect(CHIULON.chapters[0]!.id).toBe('open');
    expect(CHIULON.chapters.at(-1)!.id).toBe('atlas');
  });

  it('flies roughly 5,000 km nonstop from Manipur to Somalia, as reported', () => {
    const sea = CHIULON.chapters.find((c) => c.id === 'sea')!;
    const km = sea.counters![0]!.range[1];
    expect(km).toBeGreaterThan(4500);
    expect(km).toBeLessThan(5600);
  });

  it('starts in Manipur and ends in southern Africa', () => {
    expect(CHIULON_ROUTE[0]![1]).toBeCloseTo(25, 0);
    expect(CHIULON_PATH.at(1)[1]).toBeLessThan(-20);
  });

  it('cites a source for every factual chapter', () => {
    const factual = CHIULON.chapters.filter((c) => !['open', 'return', 'atlas'].includes(c.id));
    expect(CHIULON.chapters.find((c) => c.id === 'meet')?.profile).toBe(true);
    expect(factual.every((c) => (c.sources?.length ?? 0) > 0)).toBe(true);
  });

  it('keeps the track hidden until Chiulon is introduced', () => {
    const before = CHIULON.chapters.findIndex((c) => c.id === 'gathering');
    expect(stateAt(CHIULON, before).channels.track).toBe(0);
  });

  it('drives every Living Earth material, with wind loudest over the sea crossing', () => {
    CHIULON.chapters.forEach((c) => MATERIAL_CHANNELS.forEach((k) => expect(c.channels[k]).toBeGreaterThanOrEqual(0)));
    const sea = CHIULON.chapters.find((c) => c.id === 'sea')!.channels;
    expect(sea.wind).toBe(Math.max(...CHIULON.chapters.map((c) => c.channels.wind!)));
    expect(sea.wind).toBeGreaterThan(sea.water!);
  });
});
