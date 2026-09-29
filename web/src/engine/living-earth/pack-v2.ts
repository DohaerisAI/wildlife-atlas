import { bitmap, loadPack, PackError, pixels, type LoadedPack, type PackChannel, type PackManifest } from './pack';

/** Pack v2 layers (docs/plans/atlas-v2.md): monthly ocean, and static land class and relief. */
export interface PackV2Layers {
  readonly ocean: { readonly file: string; readonly month: readonly [number, number]; readonly channels: readonly PackChannel[] };
  readonly land: { readonly file: string; readonly size: readonly [number, number]; readonly channels: readonly PackChannel[] };
  readonly relief: { readonly file: string; readonly size: readonly [number, number]; readonly channels: readonly PackChannel[] };
  readonly classes: readonly { readonly index: number; readonly name: string; readonly label: string }[];
}
export type PackManifestV2 = PackManifest & PackV2Layers;

const REQUIRED = { ocean: ['current_u', 'current_v', 'chlorophyll'], land: ['class', 'tree', 'hillshade'], relief: ['elevation', 'lights'] } as const;
/** relief.png elevation: metres = R*256 + G + this */
export const ELEVATION_LO = -11000;

export function isV2(m: PackManifest): m is PackManifestV2 {
  return m.version === 2;
}

export function validateV2(m: PackManifest): PackManifestV2 {
  if (!isV2(m)) throw new PackError('Living Earth pack v2 expected');
  (Object.keys(REQUIRED) as (keyof typeof REQUIRED)[]).forEach((key) => {
    const layer = (m as unknown as Record<string, { file?: unknown; channels?: PackChannel[] }>)[key];
    if (!layer || typeof layer.file !== 'string') throw new PackError(`Living Earth ${key}: missing`);
    REQUIRED[key].forEach((name, i) => {
      const c = layer.channels?.[i];
      if (!c || c.name !== name || !c.source) throw new PackError(`Living Earth ${key}: channel ${i} must be ${name} with a source`);
    });
  });
  if (!Array.isArray(m.classes) || m.classes.length < 12) throw new PackError('Living Earth land classes missing');
  return m;
}

/** Ocean bytes: 0 = no data, 1..255 = lo..hi. */
export function decodeFlagged(b: number, ch: Pick<PackChannel, 'lo' | 'hi'>): number | null {
  if (b < 0.5) return null;
  return ch.lo + ((b - 1) / 254) * (ch.hi - ch.lo);
}

export const decodeElevation = (hi: number, lo: number): number => hi * 256 + lo + ELEVATION_LO;

/**
 * Current u/v bytes made safe for the shared streak sampler: no-data becomes "no current" in the
 * sampler's plain encoding, so a streak never picks up a false 1.5 m/s at the coast.
 */
export function currentsForSampler(src: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    for (let c = 0; c < 2; c++) {
      const b = src[i + c]!;
      out[i + c] = b === 0 ? 127.5 : Math.round(((b - 1) / 254) * 255);
    }
    out[i + 2] = src[i + 2]!;
    out[i + 3] = 255;
  }
  return out;
}

export interface LoadedPackV2 extends LoadedPack {
  readonly manifest: PackManifestV2;
  readonly ocean: ImageBitmap;
  readonly land: ImageBitmap;
  readonly relief: ImageBitmap;
  readonly oceanPixels: Uint8ClampedArray;
  readonly landPixels: Uint8ClampedArray | null;
  readonly reliefPixels: Uint8ClampedArray | null;
}

/** Adds the v2 layers to an already loaded base pack (surface and climate are not fetched twice). */
export async function loadPackV2(baseUrl: string, probe: boolean, loaded?: LoadedPack): Promise<LoadedPackV2> {
  const base = loaded ?? await loadPack(baseUrl, probe);
  const manifest = validateV2(base.manifest);
  const [ocean, land, relief] = await Promise.all([bitmap(baseUrl + manifest.ocean.file), bitmap(baseUrl + manifest.land.file), bitmap(baseUrl + manifest.relief.file)]);
  if (land.width !== manifest.land.size[0] || land.height !== manifest.land.size[1] || relief.width !== manifest.relief.size[0] || relief.height !== manifest.relief.size[1]) throw new PackError('land or relief size does not match its manifest');
  return {
    ...base, manifest, ocean, land, relief,
    oceanPixels: pixels(ocean),
    landPixels: probe ? pixels(land) : null,
    reliefPixels: probe ? pixels(relief) : null,
  };
}
