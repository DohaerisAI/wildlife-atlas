import type { ExpressionSpecification, GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl';
import { BASEMAP_STYLE } from '../constants';
import { peakRate } from '../listing';
import type { CellsIndex, SpeciesRange } from '../types';

/** Below this zoom the map hands back to the globe. */
export const MAP_MIN_ZOOM = 4.3;
const SRC = { cells: 'atlas-cells', range: 'atlas-range' } as const;
const LAYER = { cells: 'atlas-cells-fill', range: 'atlas-range-fill', rangeLine: 'atlas-range-line', selected: 'atlas-selected' } as const;

export interface AtlasMap {
  show(center: { lng: number; lat: number }, zoom: number, animate: boolean): void;
  hide(): void;
  visible(): boolean;
  setMonth(month: number): void;
  setRange(range: SpeciesRange | null): void;
  setPlace(place: { lng: number; lat: number; cellId: string | null } | null): void;
  setPadding(right: number, bottom: number): void;
  center(): { lng: number; lat: number; zoom: number };
  onPick(fn: (lng: number, lat: number) => void): void;
  /** the visitor zoomed out far enough to go back to the globe */
  onZoomOut(fn: (at: { lng: number; lat: number }) => void): void;
}

type Feature = { type: 'Feature'; properties: Record<string, number | string>; geometry: { type: 'Polygon'; coordinates: number[][][] } };
const square = (id: string, size: number, props: Record<string, number | string>): Feature => {
  const [lat, lng] = id.split('_').map(Number) as [number, number];
  return { type: 'Feature', properties: { id, ...props }, geometry: { type: 'Polygon', coordinates: [[[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]]] } };
};
const months = (prefix: string, v: readonly number[]) => Object.fromEntries(v.map((x, i) => [`${prefix}${i + 1}`, x]));

/** The first label layer of the basemap: our data goes under it, so town names stay readable on top. */
const firstSymbol = (map: MlMap) => map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;

/**
 * The atlas up close (style guide: "Local, beyond 100 m: crossfade to the street map"). A dark basemap with
 * place names; species richness as a faint water-coloured wash; the followed species in amber.
 */
export async function createAtlasMap(container: HTMLElement, cells: CellsIndex): Promise<AtlasMap> {
  const { Map: MapCtor, Marker: MarkerCtor, NavigationControl } = await import('maplibre-gl');
  await import('maplibre-gl/dist/maplibre-gl.css');
  // MapLibre's stylesheet makes its container position: relative, so it gets its own element inside ours
  const inner = document.createElement('div');
  inner.className = 'street-map-canvas';
  container.append(inner);
  const map = new MapCtor({ container: inner, style: BASEMAP_STYLE, center: [80, 22], zoom: 5, attributionControl: { compact: true }, fadeDuration: 0 });
  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
  const maxRich = Math.max(1, ...cells.cells.flatMap((c) => c.richness));
  let month = 1;
  let ready = false;
  let pendingRange: SpeciesRange | null | undefined;
  let marker: Marker | null = null;
  const pickFns: ((lng: number, lat: number) => void)[] = [];
  const outFns: ((at: { lng: number; lat: number }) => void)[] = [];

  const paint = () => {
    if (!ready) return;
    const n = ['coalesce', ['get', `n${month}`], 0] as ExpressionSpecification;
    map.setPaintProperty(LAYER.cells, 'fill-opacity', ['interpolate', ['linear'], n, 0, 0, maxRich, 0.34] as ExpressionSpecification);
    const v = ['coalesce', ['get', `v${month}`], 0] as ExpressionSpecification;
    map.setPaintProperty(LAYER.range, 'fill-opacity', ['interpolate', ['linear'], v, 0, 0, 0.02, 0.12, 1, 0.55] as ExpressionSpecification);
    map.setPaintProperty(LAYER.rangeLine, 'line-opacity', ['case', ['>', v, 0], 0.6, 0] as ExpressionSpecification);
  };
  const applyRange = (range: SpeciesRange | null) => {
    const peak = range ? peakRate(range.cells) || 1 : 1;
    const data = { type: 'FeatureCollection' as const, features: range ? Object.entries(range.cells).map(([id, c]) => square(id, cells.cellSize, months('v', c.r.map((r) => r / peak)))) : [] };
    (map.getSource(SRC.range) as GeoJSONSource).setData(data);
  };

  map.on('style.load', () => {
    const below = firstSymbol(map);
    map.addSource(SRC.cells, { type: 'geojson', data: { type: 'FeatureCollection', features: cells.cells.map((c) => square(c.id, cells.cellSize, months('n', c.richness))) } });
    map.addSource(SRC.range, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: LAYER.cells, type: 'fill', source: SRC.cells, paint: { 'fill-color': '#62d6f2', 'fill-opacity': 0 } }, below);
    map.addLayer({ id: LAYER.range, type: 'fill', source: SRC.range, paint: { 'fill-color': '#ffb26b', 'fill-opacity': 0 } }, below);
    map.addLayer({ id: LAYER.rangeLine, type: 'line', source: SRC.range, paint: { 'line-color': '#ffb26b', 'line-width': 0.6, 'line-opacity': 0 } }, below);
    map.addLayer({ id: LAYER.selected, type: 'line', source: SRC.cells, filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#e8edf1', 'line-width': 1.6, 'line-dasharray': [2, 2] } }, below);
    ready = true;
    if (pendingRange !== undefined) applyRange(pendingRange);
    paint();
  });
  map.on('click', (e) => pickFns.forEach((fn) => fn(e.lngLat.lng, e.lngLat.lat)));
  map.on('zoomend', () => { if (!container.hidden && map.getZoom() < MAP_MIN_ZOOM) { const c = map.getCenter(); outFns.forEach((fn) => fn({ lng: c.lng, lat: c.lat })); } });
  map.on('error', (e) => console.error('Map error', e.error));

  return {
    show(center, zoom, animate) {
      const wasHidden = container.hidden;
      container.hidden = false;
      requestAnimationFrame(() => container.classList.add('is-on'));
      map.resize();
      if (wasHidden || !animate) map.jumpTo({ center: [center.lng, center.lat], zoom: wasHidden ? Math.max(MAP_MIN_ZOOM + 0.4, zoom - 1.5) : zoom });
      if (animate) map.flyTo({ center: [center.lng, center.lat], zoom, duration: 1600, essential: false });
    },
    hide() {
      container.classList.remove('is-on');
      window.setTimeout(() => { if (!container.classList.contains('is-on')) container.hidden = true; }, 500);
    },
    visible: () => !container.hidden && container.classList.contains('is-on'),
    setMonth(m) { if (m !== month) { month = m; paint(); } },
    setRange(range) { if (ready) applyRange(range); else pendingRange = range; },
    setPlace(place) {
      marker?.remove();
      marker = null;
      if (ready) map.setFilter(LAYER.selected, ['==', ['get', 'id'], place?.cellId ?? '']);
      if (!place) return;
      const el = document.createElement('div');
      el.className = 'map-pin';
      marker = new MarkerCtor({ element: el }).setLngLat([place.lng, place.lat]).addTo(map);
    },
    setPadding(right, bottom) { map.setPadding({ top: 70, left: 0, right, bottom }); },
    center() { const c = map.getCenter(); return { lng: c.lng, lat: c.lat, zoom: map.getZoom() }; },
    onPick(fn) { pickFns.push(fn); },
    onZoomOut(fn) { outFns.push(fn); },
  };
}
