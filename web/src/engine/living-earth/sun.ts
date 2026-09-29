/** Where the sun is overhead at a moment (NOAA low-precision formulas, good to ~0.5°). */
export function subsolarPoint(date: Date): { lng: number; lat: number } {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);
  const eps = (23.439 - 0.0000004 * n) * (Math.PI / 180);
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  // Greenwich mean sidereal time in degrees
  const gmst = (280.46061837 + 360.98564736629 * n) % 360;
  let lng = ((ra * 180) / Math.PI - gmst) % 360;
  if (lng > 180) lng -= 360;
  if (lng < -180) lng += 360;
  return { lng, lat: (decl * 180) / Math.PI };
}

/** The same clock time on another day of the year, so the terminator follows the chosen month. */
export function atMonth(now: Date, t: number): Date {
  const year = now.getUTCFullYear();
  const m = Math.floor(t);
  const day = 1 + Math.floor((t - m) * 30);
  return new Date(Date.UTC(year, m, Math.min(28, day), now.getUTCHours(), now.getUTCMinutes()));
}
