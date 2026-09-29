import { describe, expect, it } from 'vitest';
import { LruCache } from './cache';

describe('LruCache', () => {
  it('evicts the least recently used entries beyond the budget, never the kept ones', () => {
    const gone: string[] = [];
    const c = new LruCache<number>(2, (_v, k) => gone.push(k));
    c.set('a', 1); c.set('b', 2); c.set('c', 3);
    c.get('a'); // a is now newest; b is oldest
    expect(c.evict(new Set(['b']))).toEqual(['c']);
    expect(gone).toEqual(['c']);
    expect(c.has('a') && c.has('b')).toBe(true);
  });

  it('may stay over budget when everything is still needed', () => {
    const c = new LruCache<number>(1);
    c.set('a', 1); c.set('b', 2);
    expect(c.evict(new Set(['a', 'b']))).toEqual([]);
    expect(c.size).toBe(2);
  });

  it('disposes a replaced value and everything on clear', () => {
    const gone: number[] = [];
    const c = new LruCache<number>(5, (v) => gone.push(v));
    c.set('a', 1); c.set('a', 2); c.clear();
    expect(gone).toEqual([1, 2]);
    expect(() => new LruCache(0)).toThrow();
  });
});
