import { Map as MlMap, NavigationControl } from 'maplibre-gl';
import { BASEMAP_STYLE, INITIAL_VIEW, PLAY_INTERVAL_MS } from './constants';
import { loadCell, loadRange } from './data';
import { wikiSummary, type Place, type WikiSummary } from './external';
import { addLayers, CELLS_FILL, maxRichness, paintMonth, setRange, setSelectedCell } from './layers';
import type { Story } from './stories';
import type { CellDetail, CellIndexEntry, CellsIndex, Meta, Month, SpeciesIndexEntry, SpeciesRange } from './types';
import { h, replaceChildren } from './ui/dom';
import { renderLegend } from './ui/legend';
import { renderViewSwitch } from './ui/view-switch';
import { placeView, speciesView, storyCard, welcomeView, type PanelHandlers } from './ui/panel';
import { mountSearch } from './ui/search';
import { renderTimeline } from './ui/timeline';
import { cellIdAt, parseViewState, serializeViewState } from './url-state';

interface State {
  readonly month: Month;
  readonly species: string | null;
  readonly cell: string | null;
  readonly placeName: string | null;
  readonly playing: boolean;
  readonly story: { story: Story; step: number } | null;
}

interface Loaded {
  cell: CellDetail | null;
  range: SpeciesRange | null;
  wiki: WikiSummary | null | 'loading' | 'error';
}

export interface AppData {
  meta: Meta;
  cells: CellsIndex;
  species: SpeciesIndexEntry[];
}

export interface AppRoots {
  map: HTMLElement;
  panel: HTMLElement;
  timeline: HTMLElement;
  search: HTMLElement;
  legend: HTMLElement;
  story: HTMLElement;
  status: HTMLElement;
  viewSwitch: HTMLElement;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function startApp(data: AppData, roots: AppRoots): void {
  const names = new Map(data.species.map((s) => [s.k, s]));
  const bySci = new Map(data.species.map((s) => [s.sci.toLowerCase(), s.k]));
  const cellIndex = new Map<string, CellIndexEntry>(data.cells.cells.map((c) => [c.id, c]));
  const richnessMax = maxRichness(data.cells);
  const initial = parseViewState(location.search, (new Date().getMonth() + 1) as Month);

  let state: State = {
    month: initial.month,
    species: initial.species && names.has(initial.species) ? initial.species : null,
    cell: initial.cell && cellIndex.has(initial.cell) ? initial.cell : null,
    placeName: null, playing: false, story: null,
  };
  let loaded: Loaded = { cell: null, range: null, wiki: null };
  let timer: number | undefined;
  let mapReady = false;

  const map = new MlMap({
    container: roots.map,
    style: BASEMAP_STYLE,
    center: initial.camera ? [initial.camera.lng, initial.camera.lat] : INITIAL_VIEW.center,
    zoom: initial.camera?.zoom ?? INITIAL_VIEW.zoom,
    attributionControl: { compact: true },
  });
  if (import.meta.env.DEV) (window as unknown as { __atlasMap: MlMap }).__atlasMap = map;
  map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
  const fitPadding = () => {
    const desktop = window.matchMedia('(min-width: 761px)').matches;
    map.setPadding(desktop ? { left: roots.panel.offsetWidth + 16, top: 0, right: 0, bottom: 0 } : { left: 0, top: 0, right: 0, bottom: window.innerHeight * 0.45 });
  };
  fitPadding();
  window.addEventListener('resize', fitPadding);

  const announce = (msg: string) => { roots.status.textContent = msg; };

  const setState = (patch: Partial<State>) => {
    const prev = state;
    state = { ...state, ...patch };
    if (prev.cell !== state.cell) void refreshCell();
    if (prev.species !== state.species) void refreshSpecies();
    if (prev.playing !== state.playing) syncPlayback();
    render();
  };

  async function refreshCell() {
    const id = state.cell;
    loaded = { ...loaded, cell: null };
    if (!id) return render();
    try {
      const cell = await loadCell(id);
      if (state.cell === id) { loaded = { ...loaded, cell }; render(); }
    } catch (err) {
      console.error('Cell load failed', id, err);
      announce('Could not load this area. Try again.');
    }
  }

  async function refreshSpecies() {
    const key = state.species;
    loaded = { ...loaded, range: null, wiki: key ? 'loading' : null };
    if (mapReady) setRange(map, null, data.cells.cellSize);
    if (!key) return render();
    const sp = names.get(key)!;
    try {
      const range = await loadRange(key);
      if (state.species !== key) return;
      loaded = { ...loaded, range };
      if (mapReady) setRange(map, range, data.cells.cellSize);
      render();
    } catch (err) {
      console.error('Range load failed', key, err);
      announce('Could not load this species map.');
    }
    wikiSummary(sp.sci)
      .then((wiki) => { if (state.species === key) { loaded = { ...loaded, wiki }; render(); } })
      .catch((err) => { console.warn('Wikipedia lookup failed', err); if (state.species === key) { loaded = { ...loaded, wiki: 'error' }; render(); } });
  }

  function syncPlayback() {
    window.clearInterval(timer);
    if (!state.playing) return;
    timer = window.setInterval(() => setState({ month: ((state.month % 12) + 1) as Month }), PLAY_INTERVAL_MS);
  }

  const flyTo = (center: [number, number], zoom: number) => map.flyTo({ center, zoom, essential: false, duration: reducedMotion() ? 0 : 2200 });

  const handlers: PanelHandlers = {
    onSpecies: (key) => {
      setState({ species: key, story: null });
      announce(`Showing ${names.get(key)?.name ?? key}`);
    },
    onMonth: (month) => setState({ month }),
    onEntry: (center, zoom) => flyTo(center, zoom),
    onStory: (story) => startStory(story),
    onClose: () => setState(state.species && state.cell ? { species: null } : { species: null, cell: null, placeName: null }),
    onBackToPlace: () => setState({ species: null }),
  };

  function startStory(story: Story) {
    const key = bySci.get(story.scientific.toLowerCase());
    if (!key) { announce(`${story.scientific} is not in the current dataset`); return; }
    flyTo(story.center, story.zoom);
    setState({ species: key, cell: null, playing: false, story: { story, step: 0 }, month: story.steps[0]!.month });
  }

  function storyStep(step: number) {
    if (!state.story) return;
    setState({ story: { ...state.story, step }, month: state.story.story.steps[step]!.month });
  }

  function render() {
    const species = state.species ? names.get(state.species) ?? null : null;
    renderTimeline(roots.timeline, state.month, state.playing, {
      onMonth: (month) => setState({ month }),
      onTogglePlay: () => setState({ playing: !state.playing }),
    });
    renderLegend(roots.legend, species ? 'species' : 'richness', richnessMax, species?.name ?? null);
    renderPanel(species);
    replaceChildren(roots.story, state.story
      ? storyCard(state.story.story, state.story.step, () => storyStep(state.story!.step + 1), () => setState({ story: null }))
      : null);
    if (mapReady) {
      paintMonth(map, state.month, richnessMax, Boolean(species));
      setSelectedCell(map, state.cell);
    }
    history.replaceState(null, '', serializeViewState({ month: state.month, species: state.species, cell: state.cell, camera: camera() }));
  }

  function renderPanel(species: SpeciesIndexEntry | null) {
    roots.panel.classList.toggle('is-open', true);
    if (species && loaded.range?.k === species.k) {
      return replaceChildren(roots.panel, speciesView(species, loaded.range, state.month, data.meta, loaded.wiki, handlers, Boolean(state.cell)));
    }
    if (species) return replaceChildren(roots.panel, h('p', { class: 'panel-body muted' }, 'Loading species…'));
    const entry = state.cell ? cellIndex.get(state.cell) : undefined;
    if (entry && loaded.cell?.id === state.cell) {
      return replaceChildren(roots.panel, placeView(loaded.cell, entry, data.cells.cellSize, state.month, names, handlers, state.placeName));
    }
    if (state.cell) return replaceChildren(roots.panel, h('p', { class: 'panel-body muted' }, 'Loading area…'));
    replaceChildren(roots.panel, welcomeView(data.meta, handlers));
  }

  function camera() {
    const c = map.getCenter();
    return { lng: c.lng, lat: c.lat, zoom: map.getZoom() };
  }

  function selectPoint(lng: number, lat: number, placeName: string | null) {
    const id = cellIdAt(lng, lat, data.cells.cellSize);
    if (!cellIndex.has(id)) {
      announce(`Full species lists cover India for now${placeName ? `; ${placeName} is outside it` : ''}. Follow a species to see its worldwide range.`);
      setState({ cell: null, placeName: null });
      return;
    }
    setState({ cell: id, species: null, placeName, story: null });
  }

  mountSearch(roots.search, data.species, {
    onSpecies: handlers.onSpecies,
    onPlace: (place: Place) => { flyTo([place.lng, place.lat], 6); selectPoint(place.lng, place.lat, place.label); },
  });

  // style.load fires once the style is parsed; `load` would wait for every basemap tile.
  map.on('style.load', () => {
    map.setProjection({ type: 'globe' });
    addLayers(map, data.cells);
    mapReady = true;
    if (loaded.range) setRange(map, loaded.range, data.cells.cellSize);
    render();
  });
  map.on('error', (e) => console.error('Map error', e.error));
  map.on('click', CELLS_FILL, (e) => { const p = e.lngLat; selectPoint(p.lng, p.lat, null); });
  map.on('mouseenter', CELLS_FILL, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', CELLS_FILL, () => { map.getCanvas().style.cursor = ''; });
  map.on('moveend', () => history.replaceState(null, '', serializeViewState({ month: state.month, species: state.species, cell: state.cell, camera: camera() })));

  renderViewSwitch(roots.viewSwitch, 'map', () => {
    const c = map.getCenter();
    return { month: state.month, species: state.species, at: { lng: c.lng, lat: c.lat, zoom: map.getZoom() } };
  });
  if (new URLSearchParams(location.search).get('dive') === '1' && initial.camera && !reducedMotion()) {
    map.once('style.load', () => map.flyTo({ center: [initial.camera!.lng, initial.camera!.lat], zoom: initial.camera!.zoom + 1.6, duration: 1800 }));
  }
  if (state.cell) void refreshCell();
  if (state.species) void refreshSpecies();
  render();
}
