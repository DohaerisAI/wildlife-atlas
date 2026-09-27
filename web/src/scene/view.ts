import type { SpeciesRange } from '../types';
import type { FlowField } from './flow';

export interface CameraTarget {
  lng: number;
  lat: number;
  altitudeKm: number;
  /** Degrees below horizon; -90 looks straight down. Realistic view uses it for cinematic tilt. */
  pitch?: number;
}

export interface SpeciesLayer {
  range: SpeciesRange;
  flow: FlowField;
  peak: number;
  cellSize: number;
}

/** What each renderer (hologram, realistic) must provide. The shell owns time, data and UI. */
export interface SceneView {
  setSpecies(layer: SpeciesLayer | null): void;
  update(t: number, dt: number): void;
  flyTo(target: CameraTarget, durationMs: number): void;
  camera(): CameraTarget;
  onPick(cb: (lng: number, lat: number) => void): void;
  dispose(): void;
}

export type ViewKind = 'holo' | 'real' | 'map';

export const zoomToAltitudeKm = (zoom: number) => 36000 / 2 ** (zoom - 0.6);
export const altitudeKmToZoom = (km: number) => Math.log2(36000 / km) + 0.6;

const TILT_FULL_KM = 800;
const TILT_NONE_KM = 4000;

/** Tilt only near the ground: overhead from high altitude, blending to the requested pitch below ~800 km. */
export function effectivePitch(altitudeKm: number, requested = -90): number {
  if (altitudeKm >= TILT_NONE_KM) return -90;
  if (altitudeKm <= TILT_FULL_KM) return requested;
  const k = (altitudeKm - TILT_FULL_KM) / (TILT_NONE_KM - TILT_FULL_KM);
  return requested + (-90 - requested) * k;
}
