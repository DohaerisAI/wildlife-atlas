import { Vector2 } from 'three';
import { createGeoController } from '../engine/camera/geo-controller';
import type { GeoPose } from '../engine/camera/geo-camera';
import { createStage } from '../engine/core/stage';
import { createGlobe } from '../engine/globe/globe';
import { loadMask } from '../engine/globe/mask';
import { PlaceLabels } from '../engine/labels/place-labels';
import { createLivingEarth, type LivingEarth } from '../engine/living-earth/materials';
import { channel } from '../engine/living-earth/pack';
import { TileLayer, type TileStats } from '../engine/tiles/tile-layer';
import { watchTileset } from '../engine/tiles/tileset';
import { createHud, frameSummary } from './engine-hud';
import { zoomLook } from './engine-look';

/** Places the prototype flies to (decision 0010 check: space to Pune and Satna, and one outside India). */
export const SPOTS: Readonly<Record<string, GeoPose & { label: string }>> = {
  space: { label: 'Space', lng: 78, lat: 20, altKm: 20000 },
  india: { label: 'India', lng: 79, lat: 22, altKm: 3000 },
  pune: { label: 'Pune', lng: 73.856, lat: 18.52, altKm: 50 },
  satna: { label: 'Satna', lng: 80.827, lat: 24.577, altKm: 10 },
  serengeti: { label: 'Serengeti', lng: 34.83, lat: -2.33, altKm: 50 },
  amazon: { label: 'Amazon', lng: -60.02, lat: -3.1, altKm: 50 },
};

export interface EngineElements { readonly stage: HTMLElement; readonly labels: HTMLElement; readonly hud: HTMLElement; readonly controls: HTMLElement; readonly note: HTMLElement }

const FRAME_WINDOW = 120;

function poseFromUrl(params: URLSearchParams): GeoPose {
  const spot = SPOTS[params.get('spot') ?? ''];
  if (spot) return spot;
  const n = (k: string, d: number) => { const v = Number(params.get(k)); return params.has(k) && Number.isFinite(v) ? v : d; };
  return { lng: n('lng', SPOTS.space!.lng), lat: n('lat', SPOTS.space!.lat), altKm: n('alt', SPOTS.space!.altKm) };
}

function buildControls(root: HTMLElement, fly: (p: GeoPose) => void, setMonth: (m: number) => void, month: number, real: { on: boolean }): void {
  Object.values(SPOTS).forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = s.label;
    b.addEventListener('click', () => fly(s));
    root.appendChild(b);
  });
  const toggle = document.createElement('button');
  toggle.type = 'button';
  const label = () => { toggle.textContent = real.on ? 'Real colour: on' : 'Real colour: off'; toggle.setAttribute('aria-pressed', String(real.on)); };
  toggle.addEventListener('click', () => { real.on = !real.on; label(); });
  label();
  root.appendChild(toggle);
  const range = document.createElement('input');
  Object.assign(range, { type: 'range', min: '0.5', max: '11.5', step: '0.05', value: String(month) });
  range.setAttribute('aria-label', 'Month');
  range.addEventListener('input', () => setMonth(Number(range.value)));
  root.appendChild(range);
}

/** The one-engine prototype: tiled Living Earth from space to town, our own labels, a debug HUD. */
export async function startEngine(els: EngineElements): Promise<void> {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const params = new URLSearchParams(window.location.search);
  const base = import.meta.env.BASE_URL;
  // tiles live outside git: served locally from public/content/tiles, or from R2 once it is set up
  const tilesBase: string = import.meta.env.VITE_TILES_BASE ?? `${base}content/tiles/`;
  const stage = createStage(els.stage, { fov: 34 });
  stage.renderer.info.autoReset = false;
  const mask = await loadMask(`${base}geo/land-mask.png`);
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, stage.settings().pixelRatio);
  const globe = createGlobe(mask, stage.settings().landDots, pixelRatio());
  globe.setFocus(0);
  stage.scene.add(globe.group);
  // ?order=level loads plain coarse-first (no focus queue, prefetch, abort or crossfade) for comparison
  const tiles = new TileLayer([], { focusFirst: params.get('order') !== 'level' });
  stage.scene.add(tiles.group);
  // each tileset loads on its own and keeps retrying (a rebuild can hide a manifest for a moment)
  const setStatus = new Map<string, string>();
  const notes: string[] = [];
  const noteText = () => [...setStatus].map(([n, st]) => `${n} ${st}`).join(' + ') + (notes.length ? ` · ${notes.join(' · ')}` : '');
  for (const name of ['sites', 'detail', 'world']) {
    watchTileset(`${tilesBase}${name}/`, (st) => { setStatus.set(name, st); els.note.textContent = noteText(); },
      (ts) => { tiles.addTileset(ts); setStatus.set(name, `${ts.manifest.levels.join('–')}`); els.note.textContent = noteText(); });
  }

  let earth: LivingEarth | null = null;
  createLivingEarth(`${base}content/living-earth/v2/`, stage.scene, mask, stage.settings(), stage.renderer.capabilities.maxTextureSize, reduced, false, globe)
    .then((le) => {
      le.setTileMask(true); earth = le;
      const tex = le.surfaceTexture();
      if (tex) tiles.setSurface(tex, le.manifest.surface.month, channel(le.manifest.surface, 'ndvi'));
    })
    .catch((err: unknown) => console.warn('Living Earth pack unavailable', err));
  const labels = new PlaceLabels(els.labels, `${base}content/places/`);
  labels.load().then(() => { notes.push(labels.source); els.note.textContent = noteText(); })
    .catch((err: unknown) => console.warn('place names unavailable', err));

  const cam = createGeoController(stage.canvas, poseFromUrl(params), reduced);
  stage.canvas.tabIndex = 0;
  stage.canvas.setAttribute('aria-label', 'Globe. Drag to move, scroll or pinch to zoom from space to a town; arrow keys and plus/minus work too.');
  let month = Number(params.get('month')) || new Date().getMonth() + 0.5;
  const real = { on: params.get('real') !== '0' };
  buildControls(els.controls, (p) => cam.flyTo(p, 6000), (m) => { month = m; }, month, real);
  stage.onTier((_t, s) => { globe.rebuildDots(s.landDots, pixelRatio()); earth?.setTier(s); });

  const hud = createHud(els.hud);
  const frames: number[] = [];
  const buffer = new Vector2();
  let last = performance.now();
  let stats: TileStats = { drawn: 0, cached: 0, loading: 0, deepest: 0, wanted: 0, queued: 0, prefetch: 0, aborted: 0, failed: 0, fading: 0, focusLevel: -1 };
  let cpuMs = 0;
  stage.onFrame(({ time, dt }) => {
    const now = performance.now();
    frames.push(now - last); if (frames.length > FRAME_WINDOW) frames.shift();
    last = now;
    const info = stage.renderer.info.render;
    const calls = info.calls; const triangles = info.triangles;
    stage.renderer.info.reset();
    const { width, height } = stage.size();
    cam.update(dt, stage.camera, height);
    const pose = cam.pose();
    const look = zoomLook(pose.altKm);
    globe.update(time);
    globe.setDotOpacity(look.dotAlpha);
    globe.setGridOpacity(look.gridAlpha);
    tiles.setAlpha(look.tileAlpha);
    tiles.setMonth(month);
    tiles.uniforms.uTime.value = time;
    // close-zoom texture is off on the base tier (style guide); real colour only when switched on
    tiles.uniforms.uDetail.value = stage.tier() === 'base' || reduced ? 0 : look.detail;
    tiles.uniforms.uReal.value = real.on ? look.real : 0;
    stats = tiles.update(stage.camera, stage.renderer.getDrawingBufferSize(buffer).y, { ...cam.focus(), altKm: pose.altKm, ahead: cam.ahead() });
    earth?.update(month, time, dt, real.on ? { ...look.channels, land: 0, water: 0 } : look.channels, stage.camera);
    labels.update(stage.camera, width, height, dt, pose);
    cpuMs = performance.now() - now;
    hud.update({ sets: [...setStatus].map(([n, st]) => `${n}: ${st}`).join(' · '), altKm: pose.altKm, frameMs: frames[frames.length - 1] ?? 0, cpuMs, calls, triangles, tier: stage.tier(), labels: labels.count, tiles: stats }, frameSummary(frames));
  });

  // for the report's screenshot script and for poking at the engine from the console
  (window as unknown as { __engine: unknown }).__engine = {
    pose: () => cam.pose(),
    setPose: (p: GeoPose) => cam.setPose(p),
    flyTo: (p: GeoPose, ms?: number) => cam.flyTo(p, ms),
    stats: () => ({ ...stats, labels: labels.count, cpuMs, tier: stage.tier(), ...frameSummary(frames) }),
    busy: () => stats.loading > 0 || stats.wanted > 0 || cam.moving(),
    resetFrames: () => { frames.length = 0; },
  };
}
