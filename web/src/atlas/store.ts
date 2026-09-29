import type { Month } from '../types';

export interface Place {
  readonly lng: number;
  readonly lat: number;
  /** grid cell id when the place has a species list */
  readonly cellId: string | null;
  /** reverse-geocoded name, filled in when it arrives */
  readonly name: string | null;
  readonly detail: string | null;
}

export type PanelView = 'place' | 'species';

export interface AtlasState {
  /** continuous year position in months, 0 = 1 Jan */
  readonly t: number;
  readonly playing: boolean;
  /** species being followed on the globe and shown in the profile */
  readonly species: string | null;
  readonly place: Place | null;
  readonly panel: PanelView | null;
  readonly follow: boolean;
}

export const monthOf = (t: number): Month => ((Math.floor(t) % 12) + 1) as Month;

export interface Store {
  get(): AtlasState;
  set(patch: Partial<AtlasState>): void;
  /** called with the new and previous state after every change */
  subscribe(fn: (s: AtlasState, prev: AtlasState) => void): () => void;
}

/** One immutable state object; every change makes a new one and tells subscribers. */
export function createStore(initial: AtlasState): Store {
  let state = initial;
  const subs = new Set<(s: AtlasState, prev: AtlasState) => void>();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      const next = { ...state, ...patch };
      const changed = (Object.keys(patch) as (keyof AtlasState)[]).some((k) => prev[k] !== next[k]);
      if (!changed) return;
      state = next;
      subs.forEach((fn) => fn(state, prev));
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
