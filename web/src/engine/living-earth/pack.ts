/**
 * Living Earth globe pack (L2 contract): 12 monthly frames packed as PNG atlases, plus a manifest
 * that names every channel's source and value range. No manifest, no materials (architecture.md).
 */
export interface PackChannel { readonly name: string; readonly lo: number; readonly hi: number; readonly unit: string; readonly source: string }
export interface PackLayer { readonly file: string; readonly month: readonly [number, number]; readonly channels: readonly PackChannel[] }
export interface PackLayout { readonly cols: number; readonly rows: number; readonly order: string; readonly projection: string }

export interface PackManifest {
  readonly version: 1 | 2;
  readonly built: string;
  readonly layout: PackLayout;
  readonly surface: PackLayer;
  readonly climate: PackLayer;
  readonly attribution: string;
}

export class PackError extends Error {}

const MONTHS = 12;
const REQUIRED = { surface: ['water', 'snow', 'ndvi'], climate: ['wind_u', 'wind_v', 'temp'] } as const;

function checkLayer(layer: unknown, key: keyof typeof REQUIRED): void {
  const fail = (msg: string) => { throw new PackError(`Living Earth ${key}: ${msg}`); };
  const l = layer as Partial<PackLayer> | undefined;
  if (!l || typeof l.file !== 'string' || !Array.isArray(l.month) || l.month.length !== 2) fail('needs a file and a month size');
  const channels = l!.channels ?? [];
  REQUIRED[key].forEach((name, i) => {
    const c = channels[i];
    if (!c || c.name !== name) fail(`channel ${i} must be ${name}`);
    if (!(c!.hi > c!.lo)) fail(`channel ${name} has an empty range`);
    if (!c!.source) fail(`channel ${name} has no source`);
  });
}

export function validateManifest(raw: unknown): PackManifest {
  if (!raw || typeof raw !== 'object') throw new PackError('Living Earth pack has no manifest');
  const m = raw as Partial<PackManifest>;
  if (m.version !== 1 && m.version !== 2) throw new PackError(`Living Earth manifest version ${String(m.version)} is not supported`);
  if (!m.layout || m.layout.cols * m.layout.rows !== MONTHS) throw new PackError('Living Earth layout must hold 12 months');
  checkLayer(m.surface, 'surface');
  checkLayer(m.climate, 'climate');
  if (!m.attribution) throw new PackError('Living Earth manifest has no attribution');
  return m as PackManifest;
}

export interface MonthBlend { readonly m0: number; readonly m1: number; readonly w: number }

/** Monthly frames sit at mid-month (t = month + 0.5); between them we crossfade with ease-in-out. */
export function monthBlend(t: number): MonthBlend {
  const f = t - 0.5;
  const base = Math.floor(f);
  const x = f - base;
  const m0 = ((base % MONTHS) + MONTHS) % MONTHS;
  return { m0, m1: (m0 + 1) % MONTHS, w: x * x * (3 - 2 * x) };
}

/** Column and row of a month (0 = January) in the atlas. */
export function tileOf(month: number, layout: Pick<PackLayout, 'cols'>): [number, number] {
  return [month % layout.cols, Math.floor(month / layout.cols)];
}

export function decodeByte(b: number, ch: Pick<PackChannel, 'lo' | 'hi'>): number {
  return ch.lo + (b / 255) * (ch.hi - ch.lo);
}

export function channel(layer: PackLayer, name: string): PackChannel {
  const c = layer.channels.find((x) => x.name === name);
  if (!c) throw new PackError(`Living Earth channel ${name} missing`);
  return c;
}

export interface LoadedPack {
  readonly manifest: PackManifest;
  readonly surface: ImageBitmap;
  readonly climate: ImageBitmap;
  /** RGBA pixels of the climate atlas, for sampling wind on the CPU */
  readonly climatePixels: Uint8ClampedArray;
  /** RGBA pixels of the surface atlas, only when asked for (the probe reads them) */
  readonly surfacePixels: Uint8ClampedArray | null;
}

/** Decode without colour conversion: these are measurements, not pictures. */
export async function bitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new PackError(`Living Earth ${url}: HTTP ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

export function pixels(img: ImageBitmap): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new PackError('2D canvas unavailable for reading the pack');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height).data;
}

export async function loadPack(baseUrl: string, withSurfacePixels = false): Promise<LoadedPack> {
  const res = await fetch(`${baseUrl}manifest.json`);
  if (!res.ok) throw new PackError(`Living Earth manifest: HTTP ${res.status}`);
  const manifest = validateManifest(await res.json());
  const [surface, climate] = await Promise.all([bitmap(baseUrl + manifest.surface.file), bitmap(baseUrl + manifest.climate.file)]);
  const [sw, sh] = manifest.surface.month;
  if (surface.width !== sw * manifest.layout.cols || surface.height !== sh * manifest.layout.rows) throw new PackError('surface atlas size does not match its manifest');
  return { manifest, surface, climate, climatePixels: pixels(climate), surfacePixels: withSurfacePixels ? pixels(surface) : null };
}
