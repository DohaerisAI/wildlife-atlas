/** Equirectangular land mask: red = land, green = India. Sampled on the CPU to place land dots. */
export interface LandMask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface MaskSample { land: boolean; india: boolean }

export function sampleMask(mask: LandMask, lng: number, lat: number): MaskSample {
  const x = Math.min(mask.width - 1, Math.max(0, Math.floor(((lng + 180) / 360) * mask.width)));
  const y = Math.min(mask.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * mask.height)));
  const i = (y * mask.width + x) * 4;
  return { land: (mask.data[i] ?? 0) > 127, india: (mask.data[i + 1] ?? 0) > 127 };
}

export async function loadMask(url: string): Promise<LandMask> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable for the land mask');
  ctx.drawImage(img, 0, 0);
  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}

/** Evenly spread points on the sphere (Fibonacci spiral), so poles don't bunch up. */
export function fibonacciLngLat(n: number, i: number): [number, number] {
  const y = 1 - (2 * (i + 0.5)) / n;
  const phi = i * Math.PI * (3 - Math.sqrt(5));
  const lat = (Math.asin(y) * 180) / Math.PI;
  const lng = ((((phi * 180) / Math.PI) % 360) + 540) % 360 - 180;
  return [lng, lat];
}
