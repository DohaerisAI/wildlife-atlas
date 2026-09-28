import { describe, expect, it } from 'vitest';
import { counterValue, lerpMonth, stateAt } from './interpolate';
import { StoryError, validateStory, type Chapter, type Story } from './schema';

const ch = (id: string, lng: number, month: number, flock: number, altKm = 5000): Chapter => ({
  id, kicker: '', title: id, body: [], camera: { lng, lat: 20, altKm, frameX: 0.1 }, month, channels: { flock },
});
const story: Story = { id: 's', title: 'S', species: 'X y', chapters: [ch('a', 0, 10.5, 1), ch('b', 60, 0.5, 0, 500), ch('c', 60, 3.5, 1)] };

describe('stateAt', () => {
  it('lands exactly on keyframes', () => {
    const s0 = stateAt(story, 0), s1 = stateAt(story, 1);
    expect(s0.lng).toBeCloseTo(0); expect(s0.channels.flock).toBe(1); expect(s0.month).toBeCloseTo(10.5);
    expect(s1.lng).toBeCloseTo(60); expect(s1.channels.flock).toBeCloseTo(0); expect(s1.altKm).toBeCloseTo(500);
  });

  it('rises mid-flight like a crane shot', () => {
    const mid = stateAt(story, 0.5);
    expect(mid.altKm).toBeGreaterThan(Math.sqrt(5000 * 500));
  });

  it('wraps months the short way', () => {
    expect(stateAt(story, 0.5).month).toBeCloseTo(11.5);
    expect(lerpMonth(11.5, 0.5, 0.5)).toBeCloseTo(0);
  });

  it('reports the chapter whose text is on screen', () => {
    expect(stateAt(story, 0.4).chapter).toBe(0);
    expect(stateAt(story, 0.6).chapter).toBe(1);
    expect(stateAt(story, 2).chapter).toBe(2);
  });

  it('clamps outside the story', () => {
    expect(stateAt(story, -3).lng).toBeCloseTo(0);
    expect(stateAt(story, 99).month).toBeCloseTo(3.5);
  });
});

describe('counters and validation', () => {
  it('maps a channel domain to a display range', () => {
    const c = { channel: 'flock', domain: [0.2, 0.6] as const, range: [0, 5000] as const, unit: 'km' };
    expect(counterValue(c, { flock: 0.4 })).toBeCloseTo(2500);
    expect(counterValue(c, { flock: 0.9 })).toBe(5000);
  });

  it('rejects inconsistent channels and bad months', () => {
    expect(() => validateStory({ ...story, chapters: [ch('a', 0, 1, 1), { ...ch('b', 0, 1, 1), channels: { other: 1 } }] })).toThrow(StoryError);
    expect(() => validateStory({ ...story, chapters: [ch('a', 0, 13, 1), ch('b', 0, 1, 1)] })).toThrow(/month/);
    expect(validateStory(story)).toBe(story);
  });
});
