import { describe, expect, it } from 'vitest';
import { LAND_CLASSES } from '../engine/living-earth/land-classes';
import { ANIMAL_COLORS, follow, MAX_FOLLOWED, unfollow } from './follow-list';

describe('followed species', () => {
  it('gives each species its own colour and keeps it', () => {
    let l = follow([], 'a');
    l = follow(l, 'b');
    l = follow(l, 'c');
    expect(l.map((f) => f.key)).toEqual(['c', 'b', 'a']);
    expect(new Set(l.map((f) => f.color)).size).toBe(3);
    const aColor = l.find((f) => f.key === 'a')!.color;
    l = follow(l, 'a');
    expect(l[0]).toEqual({ key: 'a', color: aColor });
  });

  it('drops the oldest past the limit and reuses its colour', () => {
    let l = ['a', 'b', 'c'].reduce((acc, k) => follow(acc, k), [] as ReturnType<typeof follow>);
    const aColor = l.find((f) => f.key === 'a')!.color;
    l = follow(l, 'd');
    expect(l).toHaveLength(MAX_FOLLOWED);
    expect(l.map((f) => f.key)).toEqual(['d', 'c', 'b']);
    expect(l[0]!.color).toBe(aColor);
    expect(unfollow(l, 'c').map((f) => f.key)).toEqual(['d', 'b']);
    expect(unfollow(unfollow(unfollow(l, 'c'), 'd'), 'b')).toEqual([]); // the last one can go too: an empty map
  });

  it('never shares a colour with the environment', () => {
    const env = new Set(LAND_CLASSES.map((c) => c.color.toLowerCase()));
    ANIMAL_COLORS.forEach((c) => expect(env.has(c)).toBe(false));
  });
});
