/** What the environment is at one place and month, with the dataset behind each number. */
export interface EnvReading {
  readonly windU: number;
  readonly windV: number;
  readonly tempC: number;
  readonly ndvi: number;
  readonly waterPct: number;
  readonly snowPct: number;
}

/** Extra readings from pack v2 (null where the layer has no data, e.g. currents on land). */
export interface EnvReadingV2 {
  readonly landClass: number;
  readonly treePct: number;
  readonly elevationM: number;
  readonly lightsLog: number;
  readonly currentU: number | null;
  readonly currentV: number | null;
  readonly chlLog: number | null;
}

export interface ReadingLine { readonly label: string; readonly value: string; readonly source: string }

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

/** Meteorological convention: the direction the wind blows from. */
export function windFrom(u: number, v: number): string {
  const towards = (Math.atan2(u, v) * 180) / Math.PI;
  const from = (towards + 180 + 360) % 360;
  return COMPASS[Math.round(from / 45) % 8]!;
}

export function greenness(ndvi: number): string {
  if (ndvi < 0.1) return 'bare or water';
  if (ndvi < 0.25) return 'sparse';
  if (ndvi < 0.45) return 'moderate';
  if (ndvi < 0.65) return 'green';
  return 'lush';
}

/** Lines for the probe card, in the style guide's voice: "Wind 7.4 m/s, ERA5, October mean". */
export function readingLines(r: EnvReading, onLand: boolean): ReadingLine[] {
  const speed = Math.hypot(r.windU, r.windV);
  const lines: ReadingLine[] = [
    { label: 'Wind', value: speed < 0.5 ? 'calm' : `${speed.toFixed(1)} m/s from the ${windFrom(r.windU, r.windV)}`, source: 'ERA5, 1991–2020 mean' },
    { label: 'Air', value: `${Math.round(r.tempC)} °C`, source: 'ERA5, 1991–2020 mean' },
  ];
  if (!onLand) return lines;
  return [
    ...lines,
    { label: 'Greenness', value: `NDVI ${r.ndvi.toFixed(2)} · ${greenness(r.ndvi)}`, source: 'MODIS, 2015–2024 mean' },
    { label: 'Water', value: r.waterPct < 0.5 ? 'none' : `${Math.round(r.waterPct)} % of the area`, source: 'JRC Global Surface Water' },
    { label: 'Snow', value: r.snowPct < 0.5 ? 'none' : `${Math.round(r.snowPct)} % cover`, source: 'MODIS, 2015–2024 mean' },
  ];
}

const towards = (u: number, v: number) => COMPASS[Math.round((((Math.atan2(u, v) * 180) / Math.PI + 360) % 360) / 45) % 8]!;

/** Lines for pack v2 readings: what the ground is, how high, the sea, and the lights. */
export function readingLinesV2(r: EnvReadingV2, onLand: boolean, className: (i: number) => string): ReadingLine[] {
  const lines: ReadingLine[] = [];
  if (onLand) {
    lines.push({ label: 'Ground', value: `${className(r.landClass)}${r.treePct >= 5 ? ` · ${Math.round(r.treePct)} % tree cover` : ''}`, source: 'ESA WorldCover 2021 · MODIS tree cover' });
    lines.push({ label: 'Height', value: `${Math.round(r.elevationM).toLocaleString('en-IN')} m`, source: 'NOAA ETOPO1' });
    if (r.lightsLog > 0.15) lines.push({ label: 'Night light', value: `${(10 ** r.lightsLog - 1).toFixed(1)} nW/cm²/sr`, source: 'VIIRS, 2022–2024 mean' });
  } else {
    lines.push({ label: 'Depth', value: r.elevationM < 0 ? `${Math.round(-r.elevationM).toLocaleString('en-IN')} m` : 'coast', source: 'NOAA ETOPO1' });
    if (r.currentU !== null && r.currentV !== null) {
      const sp = Math.hypot(r.currentU, r.currentV);
      lines.push({ label: 'Current', value: sp < 0.03 ? 'slack' : `${sp.toFixed(2)} m/s towards the ${towards(r.currentU, r.currentV)}`, source: 'HYCOM, 2015–2024 mean' });
    }
    if (r.chlLog !== null) lines.push({ label: 'Plankton', value: `${(10 ** r.chlLog).toFixed(2)} mg/m³ chlorophyll`, source: 'MODIS-Aqua, 2015–2024 mean' });
  }
  return lines;
}
