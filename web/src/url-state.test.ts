import { describe, expect, it } from 'vitest';
import { cellIdAt, parseViewState, serializeViewState, toMonth } from './url-state';

describe('url state', () => {
  it('round-trips', () => {
    const state = { month: 11 as const, species: 'demo-falamu', cell: '25_93', camera: { lng: 93.5, lat: 25.5, zoom: 5 } };
    expect(parseViewState(serializeViewState(state), 1)).toEqual(state);
  });

  it('falls back on bad input', () => {
    const s = parseViewState('?m=13&sp=<script>&cell=a b&at=999,0,3', 4);
    expect(s).toEqual({ month: 4, species: null, cell: null, camera: null });
  });

  it('validates months', () => {
    expect(toMonth('7', 1)).toBe(7);
    expect(toMonth('7.5', 1)).toBe(1);
    expect(toMonth(null, 2)).toBe(2);
  });
});

describe('cellIdAt', () => {
  it('snaps to south-west corner like the pipeline', () => {
    expect(cellIdAt(76.9, 10.2, 1)).toBe('10_76');
    expect(cellIdAt(76.2, 10.7, 0.5)).toBe('10.5_76');
    expect(cellIdAt(-0.5, -0.5, 1)).toBe('-1_-1');
  });
});
