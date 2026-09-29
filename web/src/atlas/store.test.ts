import { describe, expect, it, vi } from 'vitest';
import { createStore, monthOf, type AtlasState } from './store';

const INITIAL: AtlasState = { t: 9.5, playing: false, species: null, place: null, panel: null, follow: false };

describe('atlas store', () => {
  it('replaces state instead of mutating it, and tells subscribers', () => {
    const store = createStore(INITIAL);
    const fn = vi.fn();
    store.subscribe(fn);
    store.set({ species: 'k1' });
    expect(store.get()).not.toBe(INITIAL);
    expect(INITIAL.species).toBeNull();
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ species: 'k1' }), INITIAL);
  });

  it('stays quiet when nothing changes', () => {
    const store = createStore(INITIAL);
    const fn = vi.fn();
    store.subscribe(fn);
    store.set({ t: 9.5 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('reads the calendar month from the year position', () => {
    expect(monthOf(0)).toBe(1);
    expect(monthOf(9.5)).toBe(10);
    expect(monthOf(11.99)).toBe(12);
  });
});
