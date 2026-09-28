/** The year as a dial: t in months (0 = 1 Jan), angle in radians clockwise from twelve o'clock. */
const TAU = Math.PI * 2;
const MONTHS = 12;

export const timeToAngle = (t: number): number => (t / MONTHS) * TAU;

export function angleToTime(angle: number): number {
  const a = ((angle % TAU) + TAU) % TAU;
  return (a / TAU) * MONTHS;
}

/** Screen point (y down) to time, around centre (cx, cy). */
export function pointToTime(x: number, y: number, cx: number, cy: number): number {
  return angleToTime(Math.atan2(x - cx, cy - y));
}

/** Point on a circle of radius r for time t, in screen coordinates. */
export function ringPoint(t: number, r: number, cx = 0, cy = 0): [number, number] {
  const a = timeToAngle(t);
  return [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
}
