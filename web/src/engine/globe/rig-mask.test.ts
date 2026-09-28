import { describe, expect, it } from 'vitest';
import { dampPose } from './camera-rig';
import { fibonacciLngLat, sampleMask, type LandMask } from './mask';

describe('camera rig', () => {
  const a = { lng: 170, lat: 10, altKm: 20000, frameX: 0 };
  const b = { lng: -170, lat: 20, altKm: 2000, frameX: 0.2 };

  it('takes the short way across the date line', () => {
    const next = dampPose(a, b, 0.1);
    expect(next.lng).toBeGreaterThan(170);
  });

  it('converges on the target and never overshoots', () => {
    let p = a;
    for (let i = 0; i < 400; i++) p = dampPose(p, b, 1 / 60);
    expect(p.lng).toBeCloseTo(-170, 1);
    expect(p.altKm).toBeCloseTo(2000, 0);
    expect(p.frameX).toBeCloseTo(0.2, 3);
  });

  it('moves altitude evenly in log space', () => {
    const half = dampPose(a, b, Math.log(2) / 3.2);
    expect(half.altKm).toBeCloseTo(Math.sqrt(20000 * 2000), -1);
  });
});

describe('land mask', () => {
  // 4 x 2 mask: only the north-east pixel is land, and it is India
  const data = new Uint8ClampedArray(4 * 2 * 4);
  data.set([255, 255, 0, 255], (0 * 4 + 3) * 4);
  const mask: LandMask = { width: 4, height: 2, data };

  it('samples land and India flags by coordinate', () => {
    expect(sampleMask(mask, 150, 45)).toEqual({ land: true, india: true });
    expect(sampleMask(mask, -150, 45)).toEqual({ land: false, india: false });
  });

  it('clamps out-of-range coordinates', () => {
    expect(sampleMask(mask, 180, 90).land).toBe(true);
  });

  it('spreads Fibonacci points over both hemispheres within bounds', () => {
    const pts = Array.from({ length: 1000 }, (_, i) => fibonacciLngLat(1000, i));
    expect(pts.every(([lng, lat]) => lng >= -180 && lng < 180 && lat > -90 && lat < 90)).toBe(true);
    expect(pts.filter(([, lat]) => lat > 0).length).toBe(500);
  });
});
