/**
 * Grid-cell values as one soft image instead of hard squares. Values sit at cell centres and every pixel
 * blends its four nearest centres (smoothstep weights, so no creases at the centres). Rows are spaced in Web
 * Mercator so the image lines up with the map, which stretches it further with linear resampling.
 */

/** image pixels per grid cell on each axis; values are blended between cell centres at this resolution */
const PX_PER_CELL = 8;
/** one empty cell around the data so the edge fades out instead of stopping */
const PAD = 1;

export interface SurfaceImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, alpha carries the value (0..1 → 0..255) */
  readonly data: Uint8ClampedArray;
  /** corners top-left, top-right, bottom-right, bottom-left as [lng, lat] */
  readonly coordinates: [[number, number], [number, number], [number, number], [number, number]];
}

export interface SurfaceGrid {
  readonly cellSize: number;
  readonly latMin: number;
  readonly lngMin: number;
  readonly rows: number;
  readonly cols: number;
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const mercLat = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;
const parseId = (id: string) => id.split('_').map(Number) as [number, number];

/** The padded grid covering every cell id ("lat_lng" of the south-west corner). */
export function surfaceGrid(ids: readonly string[], cellSize: number): SurfaceGrid | null {
  if (!ids.length || !(cellSize > 0)) return null;
  const pts = ids.map(parseId).filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  if (!pts.length) return null;
  const lats = pts.map((p) => p[0]);
  const lngs = pts.map((p) => p[1]);
  const latMin = Math.max(-85, Math.min(...lats) - PAD * cellSize);
  const lngMin = Math.min(...lngs) - PAD * cellSize;
  const latTop = Math.min(85, Math.max(...lats) + (1 + PAD) * cellSize);
  const lngMax = Math.max(...lngs) + (1 + PAD) * cellSize;
  return {
    cellSize, latMin, lngMin,
    rows: Math.round((latTop - latMin) / cellSize),
    cols: Math.round((lngMax - lngMin) / cellSize),
  };
}

const cellKey = (grid: SurfaceGrid, row: number, col: number) =>
  `${+(grid.latMin + row * grid.cellSize).toFixed(4)}_${+(grid.lngMin + col * grid.cellSize).toFixed(4)}`;

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Paint values (0..1, keyed by cell id) into an RGBA image of one colour. Missing cells are transparent. */
export function surfaceImage(grid: SurfaceGrid, value: (id: string) => number, rgb: readonly [number, number, number]): SurfaceImage {
  const at = new Float32Array(grid.rows * grid.cols);
  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) at[r * grid.cols + c] = Math.min(1, Math.max(0, value(cellKey(grid, r, c)) || 0));
  }
  const cell = (r: number, c: number) => at[Math.min(grid.rows - 1, Math.max(0, r)) * grid.cols + Math.min(grid.cols - 1, Math.max(0, c))]!;
  const latTop = grid.latMin + grid.rows * grid.cellSize;
  const yTop = mercY(latTop);
  const yBottom = mercY(grid.latMin);
  const width = grid.cols * PX_PER_CELL;
  const height = grid.rows * PX_PER_CELL;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py += 1) {
    const lat = mercLat(yTop + ((py + 0.5) / height) * (yBottom - yTop));
    const v = (lat - grid.latMin) / grid.cellSize - 0.5;
    const r0 = Math.floor(v);
    const fv = smooth(v - r0);
    for (let px = 0; px < width; px += 1) {
      const u = (px + 0.5) / PX_PER_CELL - 0.5;
      const c0 = Math.floor(u);
      const fu = smooth(u - c0);
      const lo = cell(r0, c0) * (1 - fu) + cell(r0, c0 + 1) * fu;
      const hi = cell(r0 + 1, c0) * (1 - fu) + cell(r0 + 1, c0 + 1) * fu;
      const o = (py * width + px) * 4;
      data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2];
      data[o + 3] = Math.round((lo * (1 - fv) + hi * fv) * 255);
    }
  }
  const lngMax = grid.lngMin + grid.cols * grid.cellSize;
  return {
    width, height, data,
    coordinates: [[grid.lngMin, latTop], [lngMax, latTop], [lngMax, grid.latMin], [grid.lngMin, grid.latMin]],
  };
}

/** A data URL MapLibre can load as an image source. */
export function surfaceDataUrl(img: SurfaceImage): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for the map surface');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return canvas.toDataURL('image/png');
}
