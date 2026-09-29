import { Raycaster, Sphere, Vector2, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createStage } from '../engine/core/stage';
import { EARTH_KM, lngLatToVec3, vec3ToLngLat } from '../engine/globe/geo';
import { createGlobe } from '../engine/globe/globe';
import type { LandMask } from '../engine/globe/mask';
import { FlowLayer } from '../engine/layers/flow-layer';
import { LabelLayer } from '../engine/layers/labels';
import { createLivingEarth, type LivingEarth, type MaterialChannels } from '../engine/living-earth/materials';
import type { EnvReading } from '../engine/living-earth/reading';
import { easeInOut, type FlowField } from '../scene/flow';

const MIN_DIST = 1.06;
const MAX_DIST = 8;
const PICK_SLOP_PX = 5;
const HOVER_MS = 120;
const FLY_MS = 1800;
const FLOW_COLOR = '#ffb26b';

export interface CameraSpot { readonly lng: number; readonly lat: number; readonly altitudeKm: number }

export interface AtlasGlobe {
  setMonth(t: number): void;
  setFlow(flow: FlowField | null): void;
  setEnvironment(ch: MaterialChannels): void;
  /** keep the globe centred in the space left of a side panel (px wide) or above a bottom sheet (px tall) */
  setInset(right: number, bottom?: number): void;
  flyTo(spot: CameraSpot, ms?: number): void;
  camera(): CameraSpot;
  /** mark the chosen place in the scene, or clear it */
  setPlace(place: { lng: number; lat: number; label: string } | null): void;
  sample(lng: number, lat: number): { reading: EnvReading; onLand: boolean } | null;
  onPick(fn: (lng: number, lat: number) => void): void;
  onHover(fn: (at: { lng: number; lat: number; x: number; y: number } | null) => void): void;
  onDrag(fn: () => void): void;
  /** fires once the Living Earth pack is on the globe */
  onEarth(fn: (earth: LivingEarth) => void): void;
}

interface Flight { readonly from: Vector3; readonly to: Vector3; readonly start: number; readonly dur: number }

export function createAtlasGlobe(stageRoot: HTMLElement, pinsRoot: HTMLElement, mask: LandMask, reduced: boolean): AtlasGlobe {
  const stage = createStage(stageRoot, { fov: 36 });
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, stage.settings().pixelRatio);
  const globe = createGlobe(mask, stage.settings().landDots, pixelRatio());
  globe.setFocus(0.5);
  stage.scene.add(globe.group);
  stage.camera.position.copy(lngLatToVec3(80, 20, 4));

  const controls = new OrbitControls(stage.camera, stage.canvas);
  Object.assign(controls, { enableDamping: !reduced, dampingFactor: 0.07, rotateSpeed: 0.42, zoomSpeed: 0.8, enablePan: false, minDistance: MIN_DIST, maxDistance: MAX_DIST });
  // slower rotation close in, so a region does not fly past under the finger
  controls.addEventListener('change', () => { controls.rotateSpeed = Math.min(0.42, 0.1 + (stage.camera.position.length() - 1) * 0.12); });

  const labels = new LabelLayer(pinsRoot);
  let env: MaterialChannels = { water: 0.8, snow: 0.8, wind: 0.6 };
  let earth: LivingEarth | null = null;
  const earthFns: ((e: LivingEarth) => void)[] = [];
  createLivingEarth(`${import.meta.env.BASE_URL}content/living-earth/v1/`, stage.scene, mask, stage.settings(), stage.renderer.capabilities.maxTextureSize, reduced, true)
    .then((le) => { le.setTier(stage.settings()); earth = le; earthFns.forEach((fn) => fn(le)); })
    .catch((err) => console.warn('Living Earth pack unavailable; the globe shows land only', err));

  let flow: FlowLayer | null = null;
  let flight: Flight | null = null;
  let month = 0;
  let inset = { right: 0, bottom: 0 };
  const applyInset = () => {
    const { width, height } = stage.size();
    if (inset.right > 0 || inset.bottom > 0) stage.camera.setViewOffset(width, height, inset.right / 2, inset.bottom / 2, width, height);
    else stage.camera.clearViewOffset();
  };
  new ResizeObserver(applyInset).observe(stageRoot);

  stage.onTier((_t, s) => { globe.rebuildDots(s.landDots, pixelRatio()); earth?.setTier(s); });
  stage.onFrame(({ time, dt }) => {
    if (flight) {
      const k = reduced ? 1 : Math.min(1, (performance.now() - flight.start) / flight.dur);
      const e = easeInOut(k);
      // crane shot: rise a little mid-flight, then settle
      const lift = Math.sin(Math.PI * e) * Math.min(1.2, flight.from.distanceTo(flight.to) * 0.35);
      const len = flight.from.length() + (flight.to.length() - flight.from.length()) * e + lift;
      stage.camera.position.copy(flight.from).normalize().lerp(flight.to.clone().normalize(), e).normalize().multiplyScalar(len);
      if (k >= 1) flight = null;
    }
    controls.update();
    globe.update(time);
    flow?.update(month);
    earth?.update(month, time, dt, env, stage.camera);
    const { width, height } = stage.size();
    labels.update(stage.camera, width, height);
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
  stage.canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; flight = null; });
  stage.canvas.addEventListener('pointermove', (e) => {
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > PICK_SLOP_PX) dragFns.forEach((fn) => fn());
    if (e.pointerType !== 'mouse') return;
    window.clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => {
      const at = toGlobe(e.clientX, e.clientY);
      hoverFns.forEach((fn) => fn(at ? { ...at, x: e.clientX, y: e.clientY } : null));
    }, HOVER_MS);
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
    setFlow(next) {
      if (flow) { stage.scene.remove(flow.group); flow.dispose(); flow = null; }
      if (!next) return;
      flow = new FlowLayer(next, FLOW_COLOR, pixelRatio());
      stage.scene.add(flow.group);
    },
    setEnvironment(ch) { env = ch; },
    setInset(right, bottom = 0) { inset = { right, bottom }; applyInset(); },
    flyTo(spot, ms = FLY_MS) {
      const dist = Math.min(MAX_DIST, Math.max(MIN_DIST, 1 + spot.altitudeKm / EARTH_KM));
      const to = lngLatToVec3(spot.lng, spot.lat, dist);
      if (ms <= 0 || reduced) { stage.camera.position.copy(to); flight = null; return; }
      flight = { from: stage.camera.position.clone(), to, start: performance.now(), dur: ms };
    },
    camera() {
      const { lng, lat } = vec3ToLngLat(stage.camera.position);
      return { lng, lat, altitudeKm: (stage.camera.position.length() - 1) * EARTH_KM };
    },
    setPlace(place) {
      if (!place) { labels.setOpacity('place', 0); return; }
      labels.upsert('place', place.label, place.lng, place.lat, 'place');
      labels.setOpacity('place', 1);
    },
    sample: (lng, lat) => earth?.sample(lng, lat, month) ?? null,
    onPick: (fn) => { pickFns.push(fn); },
    onHover: (fn) => { hoverFns.push(fn); },
    onDrag: (fn) => { dragFns.push(fn); },
    onEarth: (fn) => { if (earth) fn(earth); else earthFns.push(fn); },
  };
}
