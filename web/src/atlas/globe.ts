import { Raycaster, Sphere, Vector2, Vector3 } from 'three';
import { createGeoController } from '../engine/camera/geo-controller';
import { floorForLevel } from '../engine/camera/geo-camera';
import { createStage } from '../engine/core/stage';
import { vec3ToLngLat } from '../engine/globe/geo';
import { createGlobe } from '../engine/globe/globe';
import type { LandMask } from '../engine/globe/mask';
import { PlaceLabels } from '../engine/labels/place-labels';
import { CellLayer } from '../engine/layers/cell-layer';
import { FlowLayer } from '../engine/layers/flow-layer';
import { LabelLayer } from '../engine/layers/labels';
import { createLivingEarth, type LivingEarth, type MaterialChannels } from '../engine/living-earth/materials';
import { channel } from '../engine/living-earth/pack';
import { TileLayer } from '../engine/tiles/tile-layer';
import { watchTileset } from '../engine/tiles/tileset';
import { closeness, zoomLook } from '../experiences/engine-look';
import type { FlowField } from '../scene/flow';
import type { SpeciesRange } from '../types';

/**
 * The atlas view on the one engine (decision 0010): the tiled Living Earth globe from space to a town in one
 * view, with the species flows, our place names, the followed species' range wash and the selected cell square.
 * No street-map hand-over.
 */
const PICK_SLOP_PX = 5;
const HOVER_MS = 120;
const FLY_MS = 1800;
const WASH_OPACITY = 0.55;

export interface CameraSpot { readonly lng: number; readonly lat: number; readonly altitudeKm: number }

export interface AtlasGlobe {
  setMonth(t: number): void;
  /** species flows on the globe, each in its own colour; keyed so unchanged ones are kept */
  setFlows(flows: readonly { key: string; flow: FlowField; color: string }[]): void;
  setEnvironment(ch: MaterialChannels): void;
  /** keep the globe centred in the space left of a side panel (px wide) or above a bottom sheet (px tall) */
  setInset(right: number, bottom?: number): void;
  flyTo(spot: CameraSpot, ms?: number): void;
  camera(): CameraSpot;
  /** mark the chosen place in the scene, or clear it; `cellId` outlines the grid square its species list covers */
  setPlace(place: { lng: number; lat: number; label: string; cellId?: string | null } | null): void;
  /** the panel's species as a wash of its range cells, in its follow colour */
  setRange(range: SpeciesRange | null, color?: string): void;
  /** blend our Sentinel-2 true-colour mosaic in close up */
  setRealColour(on: boolean): void;
  sample(lng: number, lat: number): ReturnType<LivingEarth['sample']>;
  onPick(fn: (lng: number, lat: number) => void): void;
  onHover(fn: (at: { lng: number; lat: number; x: number; y: number } | null) => void): void;
  onDrag(fn: () => void): void;
  /** fires once the Living Earth pack is on the globe */
  onEarth(fn: (earth: LivingEarth) => void): void;
  setActive(on: boolean): void;
}

export function createAtlasGlobe(stageRoot: HTMLElement, pinsRoot: HTMLElement, mask: LandMask, reduced: boolean, cellSize: number): AtlasGlobe {
  const stage = createStage(stageRoot, { fov: 34 });
  const base = import.meta.env.BASE_URL;
  const tilesBase: string = import.meta.env.VITE_TILES_BASE ?? `${base}content/tiles/`;
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, stage.settings().pixelRatio);
  const globe = createGlobe(mask, stage.settings().landDots, pixelRatio());
  globe.setFocus(0.5);
  stage.scene.add(globe.group);
  const tiles = new TileLayer([]);
  stage.scene.add(tiles.group);
  // sites: sharp Sentinel-2 colour (~75 m, levels 9-11) where it has been built; MODIS (~500 m) elsewhere
  for (const name of ['sites', 'detail', 'world']) watchTileset(`${tilesBase}${name}/`, () => {}, (ts) => tiles.addTileset(ts));
  const cellsLayer = new CellLayer(cellSize);
  stage.scene.add(cellsLayer.group);

  const cam = createGeoController(stage.canvas, { lng: 80, lat: 20, altKm: 19000 }, reduced);
  const places = new PlaceLabels(pinsRoot, `${base}content/places/`);
  places.load().catch((err: unknown) => console.warn('place names unavailable', err));
  const pin = new LabelLayer(pinsRoot);

  let env: MaterialChannels = { water: 0.8, snow: 0.8, wind: 0.6 };
  let earth: LivingEarth | null = null;
  const earthFns: ((e: LivingEarth) => void)[] = [];
  createLivingEarth(`${base}content/living-earth/v2/`, stage.scene, mask, stage.settings(), stage.renderer.capabilities.maxTextureSize, reduced, true, globe)
    .then((le) => {
      le.setTier(stage.settings()); le.setTileMask(true); earth = le;
      const tex = le.surfaceTexture();
      if (tex) tiles.setSurface(tex, le.manifest.surface.month, channel(le.manifest.surface, 'ndvi'));
      earthFns.forEach((fn) => fn(le));
    })
    .catch((err) => console.warn('Living Earth pack unavailable; the globe shows land only', err));

  const flows = new Map<string, { layer: FlowLayer; color: string }>();
  let month = 0;
  let real = false;
  let inset = { right: 0, bottom: 0 };

  stage.onTier((_t, s) => { globe.rebuildDots(s.landDots, pixelRatio()); earth?.setTier(s); });
  const buffer = new Vector2();
  stage.onFrame(({ time, dt }) => {
    const { width, height } = stage.size();
    cam.update(dt, stage.camera, height);
    if (inset.right > 0 || inset.bottom > 0) stage.camera.setViewOffset(width, height, inset.right / 2, inset.bottom / 2, width, height);
    else if (stage.camera.view?.enabled) stage.camera.clearViewOffset();
    const pose = cam.pose();
    cam.setFloor(floorForLevel(tiles.deepestAt(pose.lng, pose.lat))); // closer only where finer tiles exist
    const look = zoomLook(pose.altKm);
    globe.update(time);
    globe.setDotOpacity(real ? 0 : look.dotAlpha); // the hologram dots clutter real colour
    globe.setGridOpacity(look.gridAlpha);
    tiles.setAlpha(real ? 1 : look.tileAlpha); // the see-through hologram fade dimmed real colour from space
    tiles.setMonth(month);
    tiles.uniforms.uTime.value = time;
    tiles.uniforms.uDetail.value = stage.tier() === 'base' || reduced ? 0 : look.detail;
    tiles.uniforms.uReal.value = real ? look.real : 0;
    tiles.update(stage.camera, stage.renderer.getDrawingBufferSize(buffer).y, { ...cam.focus(), altKm: pose.altKm, ahead: cam.ahead() });
    cellsLayer.setMonth(((Math.floor(month) % 12) + 12) % 12);
    cellsLayer.setWashOpacity(WASH_OPACITY * closeness(pose.altKm, 1500, 6000));
    flows.forEach((f) => f.layer.update(month));
    // the story channels still switch materials; globe-scale layers fade out close in
    const ch = look.channels;
    // real colour shows the ground itself (its own snow and water): no class wash, JRC water or snow glow on top
    earth?.update(month, time, dt, { ...ch, land: real ? 0 : ch.land, water: real ? 0 : Math.min(env.water, ch.water), snow: real ? 0 : Math.min(env.snow, ch.snow), wind: Math.min(env.wind, ch.wind) }, stage.camera);
    places.update(stage.camera, width, height, dt, pose);
    pin.update(stage.camera, width, height);
  });

  const raycaster = new Raycaster();
  const surface = new Sphere(new Vector3(), 1);
  const hit = new Vector3();
  const pointer = new Vector2();
  const toGlobe = (clientX: number, clientY: number) => {
    const rect = stage.canvas.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, stage.camera);
    return raycaster.ray.intersectSphere(surface, hit) ? vec3ToLngLat(hit) : null;
  };

  const pickFns: ((lng: number, lat: number) => void)[] = [];
  const hoverFns: ((at: { lng: number; lat: number; x: number; y: number } | null) => void)[] = [];
  const dragFns: (() => void)[] = [];
  let downAt: { x: number; y: number } | null = null;
  let hoverTimer = 0;
  stage.canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  stage.canvas.addEventListener('pointermove', (e) => {
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > PICK_SLOP_PX) dragFns.forEach((fn) => fn());
    if (e.pointerType !== 'mouse') return;
    window.clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => {
      const at = toGlobe(e.clientX, e.clientY);
      hoverFns.forEach((fn) => fn(at ? { ...at, x: e.clientX, y: e.clientY } : null));
    }, HOVER_MS);
  });
  stage.canvas.addEventListener('wheel', () => dragFns.forEach((fn) => fn()), { passive: true });
  // keyboard: arrows and +/- move the camera (geo controller); Enter picks the place at the centre of the view
  stage.canvas.tabIndex = 0;
  stage.canvas.setAttribute('aria-label', 'Globe from space to street level. Arrow keys move, plus and minus zoom, Enter shows the wildlife at the centre.');
  stage.canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const p = cam.pose(); pickFns.forEach((fn) => fn(p.lng, p.lat)); e.preventDefault(); }
    else if (e.key.startsWith('Arrow') || e.key === '+' || e.key === '-' || e.key === '=') dragFns.forEach((fn) => fn());
  });
  stage.canvas.addEventListener('pointerleave', () => { window.clearTimeout(hoverTimer); hoverFns.forEach((fn) => fn(null)); });
  stage.canvas.addEventListener('pointerup', (e) => {
    const start = downAt;
    downAt = null;
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > PICK_SLOP_PX) return;
    const at = toGlobe(e.clientX, e.clientY);
    if (at) pickFns.forEach((fn) => fn(at.lng, at.lat));
  });

  return {
    setMonth(t) { month = t; },
    setFlows(next) {
      const keep = new Set(next.map((f) => `${f.key}|${f.color}`));
      for (const [id, f] of flows) if (!keep.has(id)) { stage.scene.remove(f.layer.group); f.layer.dispose(); flows.delete(id); }
      for (const f of next) {
        const id = `${f.key}|${f.color}`;
        if (flows.has(id)) continue;
        const layer = new FlowLayer(f.flow, f.color, pixelRatio());
        stage.scene.add(layer.group);
        flows.set(id, { layer, color: f.color });
      }
    },
    setEnvironment(ch) { env = ch; },
    setInset(right, bottom = 0) { inset = { right, bottom }; },
    flyTo(spot, ms = FLY_MS) {
      const to = { lng: spot.lng, lat: spot.lat, altKm: spot.altitudeKm };
      if (ms <= 0 || reduced) cam.setPose(to);
      // long hops (space to a town) get time to read as one continuous motion
      else cam.flyTo(to, Math.max(ms, Math.abs(Math.log(Math.max(1, cam.pose().altKm) / Math.max(1, spot.altitudeKm))) * 450));
    },
    camera() { const p = cam.pose(); return { lng: p.lng, lat: p.lat, altitudeKm: p.altKm }; },
    setPlace(place) {
      cellsLayer.setSelected(place?.cellId ?? null);
      if (!place) { pin.setOpacity('place', 0); return; }
      pin.upsert('place', place.label, place.lng, place.lat, 'place');
      pin.setOpacity('place', 1);
    },
    setRange(range, color) { cellsLayer.setRange(range?.cells ?? null, color); },
    setRealColour(on) { real = on; },
    sample: (lng, lat) => earth?.sample(lng, lat, month) ?? null,
    onPick: (fn) => { pickFns.push(fn); },
    onHover: (fn) => { hoverFns.push(fn); },
    onDrag: (fn) => { dragFns.push(fn); },
    onEarth: (fn) => { if (earth) fn(earth); else earthFns.push(fn); },
    setActive: (on) => stage.setActive(on),
  };
}
