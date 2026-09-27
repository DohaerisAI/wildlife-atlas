/** Small seeded PRNG (mulberry32) so particle layouts are stable across reloads. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hilbert-curve index of (x, y) on an n×n grid (n a power of two). Keeps nearby cells close in 1D. */
export function hilbertIndex(n: number, x: number, y: number): number {
  let d = 0;
  let px = x;
  let py = y;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (px & s) > 0 ? 1 : 0;
    const ry = (py & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { px = s - 1 - px; py = s - 1 - py; }
      [px, py] = [py, px];
    }
  }
  return d;
}
