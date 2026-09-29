import type { CanvasSource, ImageSource, Map as MlMap, Marker } from 'maplibre-gl';
import { BASEMAP_STYLE } from '../constants';
import { peakRate } from '../listing';
import type { CellsIndex, SpeciesRange } from '../types';
import { landTint, TINT_LAT, type LandTintSource } from '../engine/living-earth/land-tint';
import { surfaceDataUrl, surfaceGrid, surfaceImage, type SurfaceGrid } from './smooth-surface';

/** Below this zoom the map hands back to the globe. */
export const MAP_MIN_ZOOM = 4.3;
const SRC = { cells: 'atlas-cells', rich: 'atlas-rich', range: 'atlas-range', tint: 'atlas-land-tint' } as const;
const TINT_W = 2048;
const LAYER = { tint: 'atlas-land-tint', rich: 'atlas-rich-wash', range: 'atlas-range-wash', selected: 'atlas-selected' } as const;
const WATER: readonly [number, number, number] = [98, 214, 242];
const AMBER: readonly [number, number, number] = [255, 178, 107];
let rangeRgb: readonly [number, number, number] = AMBER;
/** peak opacity of each wash; the value itself rides in the image's alpha */
const OPACITY = { rich: 0.34, range: 0.6 } as const;

export interface AtlasMap {
  show(center: { lng: number; lat: number }, zoom: number, animate: boolean): void;
  hide(): void;
  visible(): boolean;
  setMonth(month: number): void;
  /** paint the Living Earth land look under the streets, for the fractional month t */
  setLandTint(src: LandTintSource | null, t: number): void;
  /** the panel's species as a wash, in its follow colour (#rrggbb) */
  setRange(range: SpeciesRange | null, color?: string): void;
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
  let marker: Marker | null = null;
  let areaLabel: Marker | null = null;
  const pickFns: ((lng: number, lat: number) => void)[] = [];
  const outFns: ((at: { lng: number; lat: number }) => void)[] = [];

  const grid: SurfaceGrid | null = surfaceGrid(cells.cells.map((c) => c.id), cells.cellSize);
  const richOf = new Map(cells.cells.map((c) => [c.id, c.richness]));
  let range: SpeciesRange | null = null;
  const draw = (src: string, value: (id: string) => number, rgb: readonly [number, number, number]) => {
    if (!ready || !grid) return;
    const img = surfaceImage(grid, value, rgb);
    (map.getSource(src) as ImageSource).updateImage({ url: surfaceDataUrl(img), coordinates: img.coordinates });
  };
  const paint = () => {
    const i = month - 1;
    draw(SRC.rich, (id) => (richOf.get(id)?.[i] ?? 0) / maxRich, WATER);
    const peak = range ? peakRate(range.cells) || 1 : 1;
    const rc = range?.cells;
    // a small floor so a single record still shows as a faint glow, as the old fill did
    draw(SRC.range, (id) => { const r = rc?.[id]?.r[i] ?? 0; return r > 0 ? 0.2 + 0.8 * (r / peak) : 0; }, rangeRgb);
  };
  const applyRange = (next: SpeciesRange | null) => { range = next; paint(); };

  // Living Earth land look, redrawn in Mercator on a canvas: 20 km pixels, enough as a tint under the streets
  const tintCanvas = document.createElement('canvas');
  tintCanvas.width = TINT_W;
  tintCanvas.height = Math.round((TINT_W * 2 * Math.log(Math.tan(Math.PI / 4 + (TINT_LAT * Math.PI) / 360))) / (2 * Math.PI));
  let tintDrawn: { src: LandTintSource; month: number } | null = null;
  let tintPending: { src: LandTintSource; t: number } | null = null;
  const drawTint = (src: LandTintSource, t: number) => {
    const month = Math.round(t * 2) / 2; // redraw at most twice a month's worth of change
    if (tintDrawn && tintDrawn.src === src && tintDrawn.month === month) return;
    const ctx = tintCanvas.getContext('2d');
    if (!ctx) return;
    const px = landTint(src, month, tintCanvas.width, tintCanvas.height);
    const img = ctx.createImageData(tintCanvas.width, tintCanvas.height);
    img.data.set(px);
    ctx.putImageData(img, 0, 0);
    tintDrawn = { src, month };
    const source = map.getSource(SRC.tint) as CanvasSource | undefined;
    source?.play();
    requestAnimationFrame(() => source?.pause());
  };

  map.on('style.load', () => {
    const below = firstSymbol(map);
    map.addSource(SRC.tint, { type: 'canvas', canvas: tintCanvas, animate: false, coordinates: [[-180, TINT_LAT], [180, TINT_LAT], [180, -TINT_LAT], [-180, -TINT_LAT]] });
    // strong right after the hand-over from the globe, fading as streets take over
    map.addLayer({ id: LAYER.tint, type: 'raster', source: SRC.tint, paint: {
      'raster-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.95, 7, 0.85, 10, 0.55, 13, 0.3] as unknown as number,
      'raster-resampling': 'linear', 'raster-fade-duration': 0, 'raster-saturation': -0.15,
    } }, below);
    map.addSource(SRC.cells, { type: 'geojson', data: { type: 'FeatureCollection', features: cells.cells.map((c) => square(c.id, cells.cellSize, {})) } });
    if (grid) {
      const blank = surfaceImage(grid, () => 0, WATER);
      const url = surfaceDataUrl(blank);
      map.addSource(SRC.rich, { type: 'image', url, coordinates: blank.coordinates });
      map.addSource(SRC.range, { type: 'image', url, coordinates: blank.coordinates });
      const rasterPaint = (opacity: number) => ({ 'raster-opacity': opacity, 'raster-resampling': 'linear' as const, 'raster-fade-duration': 0 });
      map.addLayer({ id: LAYER.rich, type: 'raster', source: SRC.rich, paint: rasterPaint(OPACITY.rich) }, below);
      map.addLayer({ id: LAYER.range, type: 'raster', source: SRC.range, paint: rasterPaint(OPACITY.range) }, below);
    }
    map.addLayer({ id: LAYER.selected, type: 'line', source: SRC.cells, filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#e8edf1', 'line-width': 1.6, 'line-dasharray': [2, 2] } }, below);
    ready = true;
    paint();
    if (tintPending) drawTint(tintPending.src, tintPending.t);
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
    setLandTint(src, t) {
      if (!src) return;
      tintPending = { src, t };
      if (ready) drawTint(src, t);
    },
    setMonth(m) { if (m !== month) { month = m; paint(); } },
    setRange(next, color) { if (color) rangeRgb = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)]; applyRange(next); },
    setPlace(place) {
      marker?.remove();
      areaLabel?.remove();
      marker = null;
      areaLabel = null;
      if (ready) map.setFilter(LAYER.selected, ['==', ['get', 'id'], place?.cellId ?? '']);
      if (!place) return;
      const el = document.createElement('div');
      el.className = 'map-pin';
      marker = new MarkerCtor({ element: el }).setLngLat([place.lng, place.lat]).addTo(map);
      if (place.cellId) {
        // say what the dashed square is, at its top-left corner
        const [lat, lng] = place.cellId.split('_').map(Number) as [number, number];
        const tag = document.createElement('div');
        tag.className = 'map-area-label';
        tag.textContent = `Species list covers this ~${Math.round(cells.cellSize * 110)} km square`;
        areaLabel = new MarkerCtor({ element: tag, anchor: 'bottom-left' }).setLngLat([lng, lat + cells.cellSize]).addTo(map);
      }
    },
    setPadding(right, bottom) { map.setPadding({ top: 70, left: 0, right, bottom }); },
    center() { const c = map.getCenter(); return { lng: c.lng, lat: c.lat, zoom: map.getZoom() }; },
    onPick(fn) { pickFns.push(fn); },
    onZoomOut(fn) { outFns.push(fn); },
  };
}
