import { monthBlend } from './pack';
import { sampleByte, type MonthlyPixels } from './sampler';

/** The Living Earth land look redrawn for the street map, so the hand-over from the globe feels continuous. */
export interface LandTintSource {
  /** land.png RGBA: R class index, G tree %, B hillshade */
  readonly land: { readonly data: Uint8ClampedArray; readonly width: number; readonly height: number };
  /** monthly surface atlas: B = NDVI */
  readonly surface: MonthlyPixels;
  readonly ndvi: { readonly lo: number; readonly hi: number };
  /** 12 class colours, RGB 0..1, already scaled by class strength */
  readonly palette: Float32Array;
}

/** Web Mercator covers this band; the map clips beyond it anyway. */
export const TINT_LAT = 80;
const GREEN_CLASSES = new Set([1, 2, 3, 4, 9, 10]);
/** brightness of the tint relative to the palette, tuned against the globe at the hand-over */
const TONE = 0.42;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const mercLat = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

/** Latitude of each image row, spaced in Mercator so the image lines up with the map. */
export function rowLatitudes(height: number, latMax = TINT_LAT): Float64Array {
  const top = mercY(latMax); const bottom = mercY(-latMax);
  return Float64Array.from({ length: height }, (_, y) => mercLat(top + ((y + 0.5) / height) * (bottom - top)));
}

/** RGBA pixels (alpha 0 over the sea) for the month t; same maths as the globe's land dots. */
export function landTint(src: LandTintSource, t: number, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const lats = rowLatitudes(height);
  const { m0, m1, w } = monthBlend(t);
  const { land, palette } = src;
  for (let y = 0; y < height; y++) {
    const lat = lats[y]!;
    const ly = Math.min(land.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * land.height)));
    for (let x = 0; x < width; x++) {
      const lng = -180 + ((x + 0.5) / width) * 360;
      const lx = Math.min(land.width - 1, Math.floor(((lng + 180) / 360) * land.width));
      const li = (ly * land.width + lx) * 4;
      const cls = land.data[li]!;
      if (cls === 0) continue; // sea: leave the basemap's water
      let life = 1;
      if (GREEN_CLASSES.has(cls)) {
        const b = sampleByte(src.surface, m0, 2, lng, lat) * (1 - w) + sampleByte(src.surface, m1, 2, lng, lat) * w;
        const ndvi = src.ndvi.lo + (b / 255) * (src.ndvi.hi - src.ndvi.lo);
        const g = Math.min(1, Math.max(0, (ndvi - 0.05) / 0.75));
        life = 0.3 + 0.95 * g * g * (3 - 2 * g);
      }
      const relief = 0.55 + 0.8 * (land.data[li + 2]! / 255);
      // the globe glows these colours at low strength on near-black; match its tone, not the raw palette
      const k = life * relief * 255 * TONE;
      const o = (y * width + x) * 4;
      out[o] = Math.min(255, palette[cls * 3]! * k);
      out[o + 1] = Math.min(255, palette[cls * 3 + 1]! * k);
      out[o + 2] = Math.min(255, palette[cls * 3 + 2]! * k);
      out[o + 3] = 255;
    }
  }
  return out;
}
