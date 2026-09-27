import { describe, expect, it } from 'vitest';
import { cellsGeoJson, maxRichness, rangeGeoJson } from './layers';

const twelve = <T,>(v: T): T[] => new Array(12).fill(v);

describe('layers', () => {
  it('builds cell polygons with per-month richness', () => {
    const fc = cellsGeoJson({ cellSize: 1, cells: [{ id: '10_76', total: twelve(1), richness: [3, ...twelve(0).slice(1)], coverage: twelve('some' as const) }] });
    const f = fc.features[0]! as { properties: Record<string, unknown>; geometry: { coordinates: number[][][] } };
    expect(f.geometry.coordinates[0]![0]).toEqual([76, 10]);
    expect(f.properties.n1).toBe(3);
  });

  it('normalizes species rates to the peak', () => {
    const fc = rangeGeoJson({ k: 'x', cells: { '10_76': { r: [0.2, 0.1, ...twelve(0).slice(2)], p: 'seasonal' } } }, 1);
    expect((fc.features[0]!.properties as Record<string, unknown>).v1).toBe(1);
    expect((fc.features[0]!.properties as Record<string, unknown>).v2).toBe(0.5);
  });

  it('never returns a zero max', () => {
    expect(maxRichness({ cellSize: 1, cells: [] })).toBe(1);
  });
});
