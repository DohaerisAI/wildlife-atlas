/** The visitor's position from the browser, only when they ask for it (spec 3.1: location is optional). */
export class LocateError extends Error {}

export const LOCATE_MESSAGES: Record<number, string> = {
  1: 'Location permission was declined. You can search for your town instead.',
  2: 'Your position could not be found right now. Try again, or search for your town.',
  3: 'Finding your position took too long. Try again, or search for your town.',
};

export function locateMe(timeoutMs = 12000): Promise<{ lng: number; lat: number; accuracyM: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new LocateError('This browser cannot share a location. Search for your town instead.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lng: p.coords.longitude, lat: p.coords.latitude, accuracyM: p.coords.accuracy }),
      (err) => reject(new LocateError(LOCATE_MESSAGES[err.code] ?? 'Your position is unavailable. Search for your town instead.')),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60 * 1000 },
    );
  });
}

/** Map zoom that roughly matches a globe camera altitude (web-mercator, mid-latitudes). */
export function zoomForAltitude(km: number): number {
  return Math.max(3, Math.min(14, Math.log2(40000 / Math.max(1, km)) + 1.2));
}

export function altitudeForZoom(zoom: number): number {
  return 40000 / 2 ** (zoom - 1.2);
}
