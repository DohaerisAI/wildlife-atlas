import { decodeByte, monthBlend, tileOf, type PackChannel, type PackLayout } from './pack';

/** RGBA pixels of a monthly atlas (4 x 3 tiles of one month each), for reading values on the CPU. */
export interface MonthlyPixels {
  readonly data: Uint8ClampedArray;
  readonly atlasWidth: number;
  readonly month: readonly [number, number];
  readonly layout: Pick<PackLayout, 'cols' | 'rows'>;
}

/** Bilinear byte value of one channel (0 = R) in one month; pixel centres, longitude wraps. */
export function sampleByte(p: MonthlyPixels, month: number, channel: number, lng: number, lat: number): number {
  const [w, h] = p.month;
  const [col, row] = tileOf(month, p.layout);
  const fx = ((lng + 180) / 360) * w - 0.5;
  const fy = Math.min(h - 1, Math.max(0, ((90 - lat) / 180) * h - 0.5));
  const x0 = Math.floor(fx); const y0 = Math.floor(fy);
  const tx = fx - x0; const ty = fy - y0;
  const at = (x: number, y: number) => p.data[((row * h + Math.min(h - 1, y)) * p.atlasWidth + col * w + (((x % w) + w) % w)) * 4 + channel]!;
  const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
  const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Decoded value of a channel at a place and fractional month, crossfaded like the shaders do. */
export function sampleValue(p: MonthlyPixels, channelIndex: number, ch: Pick<PackChannel, 'lo' | 'hi'>, lng: number, lat: number, t: number): number {
  const { m0, m1, w } = monthBlend(t);
  const a = sampleByte(p, m0, channelIndex, lng, lat);
  const b = w === 0 ? a : sampleByte(p, m1, channelIndex, lng, lat);
  return decodeByte(a + (b - a) * w, ch);
}
