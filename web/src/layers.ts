import type { ExpressionSpecification, GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { CellsIndex, Month, SpeciesRange } from './types';
import { peakRate } from './listing';

// Sequential ramps, one hue each (blue = richness, orange = one species). Dark basemap:
// low values sit near the surface, high values are lightest.
const BLUE = ['#104281', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#cde2fb'];
const ORANGE = ['#6b2a0f', '#9a3b16', '#c9501f', '#eb6834', '#f39a70', '#fbd3bf'];

export const LEGENDS = { richness: BLUE, species: ORANGE };

const CELLS_SRC = 'cells';
const RANGE_SRC = 'range';
export const CELLS_FILL = 'cells-fill';
const CELLS_LINE = 'cells-line';
const RANGE_FILL = 'range-fill';
const SELECTED_LINE = 'selected-line';

function ring(id: string, size: number): number[][] {
  const [lat, lng] = id.split('_').map(Number) as [number, number];
  return [[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]];
}

function polygon(id: string, size: number, props: Record<string, number | string>) {
  return { type: 'Feature' as const, properties: { id, ...props }, geometry: { type: 'Polygon' as const, coordinates: [ring(id, size)] } };
}

function monthProps(prefix: string, values: number[]): Record<string, number> {
  return Object.fromEntries(values.map((v, i) => [`${prefix}${i + 1}`, v]));
}

export function cellsGeoJson(index: CellsIndex) {
  return {
    type: 'FeatureCollection' as const,
    features: index.cells.map((c) => polygon(c.id, index.cellSize, monthProps('n', c.richness))),
  };
}

export function rangeGeoJson(range: SpeciesRange, size: number) {
  const peak = peakRate(range.cells) || 1;
  return {
    type: 'FeatureCollection' as const,
    features: Object.entries(range.cells).map(([id, c]) =>
      polygon(id, size, monthProps('v', c.r.map((r) => r / peak))),
    ),
  };
}

export function maxRichness(index: CellsIndex): number {
  return Math.max(1, ...index.cells.flatMap((c) => c.richness));
}

function ramp(prop: string, max: number, colors: string[]): ExpressionSpecification {
  const stops = colors.flatMap((c, i) => [(max * i) / (colors.length - 1), c]);
  return ['interpolate', ['linear'], ['coalesce', ['get', prop], 0], ...stops] as ExpressionSpecification;
}

export function addLayers(map: MlMap, index: CellsIndex): void {
  map.addSource(CELLS_SRC, { type: 'geojson', data: cellsGeoJson(index) });
  map.addSource(RANGE_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: CELLS_FILL, type: 'fill', source: CELLS_SRC, paint: { 'fill-opacity': 0.72 } });
  map.addLayer({ id: CELLS_LINE, type: 'line', source: CELLS_SRC, paint: { 'line-color': '#0b0f14', 'line-width': 1, 'line-opacity': 0.6 } });
  map.addLayer({ id: RANGE_FILL, type: 'fill', source: RANGE_SRC, paint: { 'fill-opacity': 0.85 } });
  map.addLayer({
    id: SELECTED_LINE, type: 'line', source: CELLS_SRC, filter: ['==', ['get', 'id'], ''],
    paint: { 'line-color': '#ffffff', 'line-width': 2.5 },
  });
}

export function paintMonth(map: MlMap, month: Month, richnessMax: number, speciesMode: boolean): void {
  map.setPaintProperty(CELLS_FILL, 'fill-color', ramp(`n${month}`, richnessMax, BLUE));
  map.setPaintProperty(CELLS_FILL, 'fill-opacity', speciesMode ? 0.12 : 0.72);
  const v = ['coalesce', ['get', `v${month}`], 0] as ExpressionSpecification;
  map.setPaintProperty(RANGE_FILL, 'fill-color', ramp(`v${month}`, 1, ORANGE));
  map.setPaintProperty(RANGE_FILL, 'fill-opacity', ['case', ['>', v, 0], 0.88, 0] as ExpressionSpecification);
}

export function setRange(map: MlMap, range: SpeciesRange | null, size: number): void {
  const data = range ? rangeGeoJson(range, size) : { type: 'FeatureCollection' as const, features: [] };
  (map.getSource(RANGE_SRC) as GeoJSONSource).setData(data);
}

export function setSelectedCell(map: MlMap, id: string | null): void {
  map.setFilter(SELECTED_LINE, ['==', ['get', 'id'], id ?? '']);
}
