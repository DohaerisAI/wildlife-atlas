import { loadRange } from '../data';
import { peakRate } from '../listing';
import { STORIES } from '../stories';
import type { CellsIndex, Meta, SpeciesIndexEntry } from '../types';
import { mountHud } from '../ui/scene-hud';
import { renderViewSwitch, viewUrl, type CarryState } from '../ui/view-switch';
import { cellIdAt, toMonth } from '../url-state';
import { createClock } from './clock';
import { createDirector } from './director';
import { buildFlow, massAt, type FlowField } from './flow';
import { flockCenter, glide, toLngLat, toVec, type Vec3 } from './follow';
import { altitudeKmToZoom, zoomToAltitudeKm, type SceneView, type ViewKind } from './view';

export interface ShellData { meta: Meta; cells: CellsIndex; species: SpeciesIndexEntry[] }

export interface ShellOptions {
  kind: Exclude<ViewKind, 'map'>;
  particles: number;
  storyPitch: number;
}

const DIVE_MS = 1500;
const URL_SYNC_MS = 1000;
const START_CAMERA = { lng: 80, lat: 20, zoom: 2.2 };

/** Pick the default species: URL, then the first story species present in the data, then the most widespread. */
function defaultSpecies(data: ShellData, requested: string | null): string | null {
  if (requested && data.species.some((s) => s.k === requested)) return requested;
  const bySci = new Map(data.species.map((s) => [s.sci.toLowerCase(), s.k]));
  for (const story of STORIES) { const k = bySci.get(story.scientific.toLowerCase()); if (k) return k; }
  return [...data.species].sort((a, b) => b.cells - a.cells)[0]?.k ?? null;
}

function parseAt(value: string | null) {
  const [lng, lat, zoom] = (value ?? '').split(',').map(Number);
  return [lng, lat, zoom].every(Number.isFinite) && Math.abs(lat!) <= 90 ? { lng: lng!, lat: lat!, zoom: zoom! } : null;
}

export function startShell(view: SceneView, data: ShellData, stage: HTMLElement, hudRoot: HTMLElement, switchRoot: HTMLElement, opts: ShellOptions): void {
  const q = new URLSearchParams(location.search);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const month = toMonth(q.get('m'), (new Date().getMonth() + 1) as 1);
  const clock = createClock(month - 1 + 0.5, reduced);
  const names = new Map(data.species.map((s) => [s.k, s]));
  const cellSet = new Set(data.cells.cells.map((c) => c.id));
  let speciesKey: string | null = null;
  let flowField: FlowField | null = null;
  let flowScratch = new Float32Array(0);
  // Follow camera: on while playing a species (not during stories), off as soon as the user drags the globe.
  let following = false;
  let followVec: Vec3 | null = null;
  const setFollow = (on: boolean) => { following = on; followVec = null; hud.setFollow(on); };

  const carry = (): CarryState => {
    const cam = view.camera();
    return { month: Math.floor(clock.time()) + 1, species: speciesKey, at: { lng: cam.lng, lat: cam.lat, zoom: altitudeKmToZoom(cam.altitudeKm) } };
  };

  const director = createDirector(view, clock, opts.storyPitch, {
    onStep: (story, index) => hud.showStory(story, index),
    onEnd: () => hud.showStory(null, 0),
  });

  const hud = mountHud(hudRoot, data.meta, data.species, {
    onScrub: (t) => { director.holdAuto(); clock.pause(); clock.set(t); },
    onMonth: (m) => { director.holdAuto(); clock.pause(); clock.glideTo(m - 1 + 0.5, 1200); },
    onTogglePlay: () => {
      director.holdAuto();
      if (clock.playing()) { clock.pause(); return; }
      clock.play();
      if (!director.active()) setFollow(true);
    },
    onToggleFollow: () => setFollow(!following),
    onSpecies: (k) => { director.stop(); void selectSpecies(k); },
    onStory: (story) => {
      setFollow(false);
      const k = data.species.find((s) => s.sci.toLowerCase() === story.scientific.toLowerCase())?.k;
      if (!k) return;
      void selectSpecies(k).then(() => director.start(story));
    },
    onStoryNext: () => director.next(),
    onStoryExit: () => director.stop(),
    onDive: (lng, lat) => dive(lng, lat),
  });

  async function selectSpecies(key: string) {
    if (key === speciesKey) return;
    speciesKey = key;
    hud.setLoading(true);
    try {
      const range = await loadRange(key);
      if (speciesKey !== key) return;
      const flow = buildFlow(range, data.cells.cellSize, opts.particles, 7);
      flowField = flow;
      flowScratch = new Float32Array(flow.count * 3);
      followVec = null;
      view.setSpecies({ range, flow, peak: peakRate(range.cells), cellSize: data.cells.cellSize });
    } catch (err) {
      console.error('Species load failed', key, err);
      view.setSpecies(null);
    } finally {
      hud.setLoading(false);
    }
  }

  function dive(lng: number, lat: number) {
    director.stop();
    const cell = cellIdAt(lng, lat, data.cells.cellSize);
    view.flyTo({ lng, lat, altitudeKm: zoomToAltitudeKm(4.2), pitch: -90 }, reduced ? 0 : DIVE_MS);
    hud.fade(true);
    const url = viewUrl('map', { month: Math.floor(clock.time()) + 1, species: null, cell, at: { lng, lat, zoom: 4.2 }, dive: true });
    window.setTimeout(() => { location.href = url; }, reduced ? 0 : DIVE_MS - 200);
  }

  view.onPick((lng, lat) => {
    const id = cellIdAt(lng, lat, data.cells.cellSize);
    hud.showPick(lng, lat, cellSet.has(id) ? id : null, data.cells.cellSize);
  });

  stage.addEventListener('pointerdown', () => { if (following) setFollow(false); });

  const followFlock = (t: number, dt: number) => {
    if (!following || !flowField || director.active()) return;
    const target = flockCenter(flowField, t, flowScratch);
    if (!target) return;
    const cam = view.camera();
    followVec = glide(followVec ?? toVec(cam.lng, cam.lat), target, dt);
    const { lng, lat } = toLngLat(followVec);
    view.flyTo({ lng, lat, altitudeKm: cam.altitudeKm, pitch: -90 }, 0);
  };

  clock.onTick((t, dt) => {
    followFlock(t, dt);
    view.update(t, dt);
    hud.setTime(t, clock.playing());
    if (flowField) hud.setSpecies(speciesKey ? names.get(speciesKey) ?? null : null, massAt(flowField, t));
  });

  renderViewSwitch(switchRoot, opts.kind, carry);
  window.setInterval(() => {
    const url = viewUrl(opts.kind, carry());
    history.replaceState(null, '', url);
  }, URL_SYNC_MS);

  const at = parseAt(q.get('at')) ?? START_CAMERA;
  view.flyTo({ lng: at.lng, lat: at.lat, altitudeKm: zoomToAltitudeKm(at.zoom), pitch: -90 }, 0);
  const initial = defaultSpecies(data, q.get('sp'));
  hud.setSpecies(initial ? names.get(initial) ?? null : null, 0);
  if (initial) void selectSpecies(initial);
}
