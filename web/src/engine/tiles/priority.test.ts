import { describe, expect, it } from 'vitest';
import { fadeIn, focusAt, focusDistance, loadScore, orderQueue, staleRequests, viewRadius } from './priority';
import { tileAt, tileKey } from './tile-math';

const FOV = (34 * Math.PI) / 180;
const pune = focusAt(73.856, 18.52, viewRadius(50, FOV));

describe('focus-first tile priority', () => {
  it('measures distance from the focus in view radii', () => {
    expect(focusDistance(tileAt(73.856, 18.52, 8), pune)).toBeCloseTo(0, 3);
    expect(focusDistance(tileAt(75.5, 18.52, 8), pune)).toBeGreaterThan(1);
    expect(viewRadius(20000, FOV)).toBeLessThan(Math.PI / 2);
    expect(viewRadius(10, FOV)).toBeLessThan(viewRadius(100, FOV));
  });

  it('loads the focus to full detail before the edges of the view', () => {
    const focusFine = { tile: tileAt(73.856, 18.52, 8), error: 4 };
    const edgeCoarse = { tile: tileAt(75.2, 18.9, 7), error: 3 };
    expect(loadScore(focusFine, pune, 1.25)).toBeLessThan(loadScore(edgeCoarse, pune, 1.25));
  });

  it('always puts a parent before its child at the same place (never a hole)', () => {
    const child = { tile: tileAt(73.856, 18.52, 8), error: 3 };
    const parent = { tile: tileAt(73.856, 18.52, 7), error: 6 };
    const q = orderQueue([child, parent], [], pune, 1.25);
    expect(q.map((w) => w.tile.z)).toEqual([7, 8]);
  });

  it('ranks prefetch after what is on screen, and dedupes to the best score', () => {
    const shown = { tile: tileAt(73.856, 18.52, 7), error: 2 };
    const pre = { tile: tileAt(73.856, 18.52, 8), error: 1 };
    const q = orderQueue([shown], [pre, shown], pune, 1.25);
    expect(q).toHaveLength(2);
    expect(q.find((w) => tileKey(w.tile) === tileKey(shown.tile))?.kind).toBe('view');
    expect(q[q.length - 1]!.kind).toBe('prefetch');
  });

  it('aborts requests that left the view after a grace period', () => {
    const inflight = new Map([['8/1/1', 1000], ['8/1/2', 1000], ['8/1/3', 1250]]);
    expect(staleRequests(inflight, new Set(['8/1/1']), 1400).sort()).toEqual(['8/1/2']);
  });

  it('crossfades new tiles in over about 200 ms', () => {
    expect(fadeIn(0, 0)).toBe(0);
    expect(fadeIn(0, 100)).toBeCloseTo(0.5);
    expect(fadeIn(0, 250)).toBe(1);
  });
});
