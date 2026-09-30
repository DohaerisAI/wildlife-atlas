import { describe, expect, it } from 'vitest';
import { cellBounds } from './bits';

describe('cellBounds', () => {
  it('names hemispheres for each edge', () => {
    expect(cellBounds('18_73', 1)).toBe('18°N to 19°N, 73°E to 74°E');
    expect(cellBounds('-4_-61', 1)).toBe('4°S to 3°S, 61°W to 60°W');
    expect(cellBounds('-1_34', 1)).toBe('1°S to 0°N, 34°E to 35°E');
  });
  it('rejects ids that are not a south-west corner', () => {
    expect(cellBounds('x_y', 1)).toBeNull();
  });
});
