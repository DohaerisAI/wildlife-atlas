import { describe, expect, it } from 'vitest';
import { currentsForSampler, decodeElevation, decodeFlagged } from './pack-v2';
import { decodeByte } from './pack';

describe('pack v2 encodings', () => {
  const cur = { lo: -1.5, hi: 1.5 };

  it('keeps no-data apart from real values', () => {
    expect(decodeFlagged(0, cur)).toBeNull();
    expect(decodeFlagged(1, cur)).toBeCloseTo(-1.5, 6);
    expect(decodeFlagged(255, cur)).toBeCloseTo(1.5, 6);
    expect(decodeFlagged(128, cur)).toBeCloseTo(0, 6);
  });

  it('decodes 16-bit elevation with the sea-floor offset', () => {
    expect(decodeElevation(42, 248)).toBe(0); // 11000 = 42*256 + 248
    expect(decodeElevation(0, 0)).toBe(-11000);
  });

  it('turns ocean no-data into zero current for the streak sampler', () => {
    const src = new Uint8ClampedArray([0, 0, 90, 255, 255, 1, 90, 255]);
    const out = currentsForSampler(src);
    expect(decodeByte(out[0]!, cur)).toBeCloseTo(0, 1);
    expect(decodeByte(out[4]!, cur)).toBeCloseTo(1.5, 6);
    expect(decodeByte(out[5]!, cur)).toBeCloseTo(-1.5, 6);
    expect(out[2]).toBe(90);
  });
});
