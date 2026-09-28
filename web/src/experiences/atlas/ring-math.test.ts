import { describe, expect, it } from 'vitest';
import { angleToTime, pointToTime, timeToAngle } from './ring-math';

describe('year ring', () => {
  it('puts January at twelve o\'clock and turns clockwise', () => {
    expect(timeToAngle(0)).toBeCloseTo(0, 6);
    expect(timeToAngle(3)).toBeCloseTo(Math.PI / 2, 6);
    expect(timeToAngle(6)).toBeCloseTo(Math.PI, 6);
  });

  it('round-trips angle and time, wrapping into 0..12', () => {
    for (const t of [0, 0.5, 5.25, 11.9]) expect(angleToTime(timeToAngle(t))).toBeCloseTo(t, 6);
    expect(angleToTime(-Math.PI / 2)).toBeCloseTo(9, 6);
  });

  it('reads a pointer position around the centre', () => {
    expect(pointToTime(100, 0, 100, 100)).toBeCloseTo(0, 6); // straight up
    expect(pointToTime(200, 100, 100, 100)).toBeCloseTo(3, 6); // right
    expect(pointToTime(100, 200, 100, 100)).toBeCloseTo(6, 6); // down
    expect(pointToTime(0, 100, 100, 100)).toBeCloseTo(9, 6); // left
  });
});
