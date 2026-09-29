import type { TileStats } from '../engine/tiles/tile-layer';

export interface HudFrame {
  readonly altKm: number;
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly calls: number;
  readonly triangles: number;
  readonly tier: string;
  readonly labels: number;
  readonly tiles: TileStats;
}

/** Rolling mean and 95th percentile of frame times (ms). */
export function frameSummary(samples: readonly number[]): { mean: number; p95: number } {
  if (samples.length === 0) return { mean: 0, p95: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  return { mean: samples.reduce((a, b) => a + b, 0) / samples.length, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! };
}

export const formatAlt = (km: number): string => (km >= 100 ? `${Math.round(km).toLocaleString('en')} km` : km >= 10 ? `${km.toFixed(1)} km` : `${km.toFixed(2)} km`);

/** Small debug readout: altitude, tiles, draw calls, frame time, level. */
export function createHud(el: HTMLElement): { update(f: HudFrame, frames: { mean: number; p95: number }): void } {
  let last = 0;
  return {
    update(f, frames) {
      const now = performance.now();
      if (now - last < 250) return;
      last = now;
      const t = f.tiles;
      el.textContent = [
        `alt    ${formatAlt(f.altKm)}`,
        `level  ${t.deepest}`,
        `tiles  ${t.drawn} drawn · ${t.cached} cached · ${t.loading} loading${t.failed ? ` · ${t.failed} failed` : ''}`,
        `draws  ${f.calls} calls · ${(f.triangles / 1000).toFixed(0)}k tris`,
        `frame  ${frames.mean.toFixed(1)} ms avg · ${frames.p95.toFixed(1)} p95 · cpu ${f.cpuMs.toFixed(2)} ms`,
        `tier   ${f.tier} · labels ${f.labels}`,
      ].join('\n');
    },
  };
}
