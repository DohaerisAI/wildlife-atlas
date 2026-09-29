import type { PerspectiveCamera } from 'three';
import { EARTH_KM, lngLatToVec3 } from '../globe/geo';
import { clampAlt, clampLat, clipPlanes, flightPose, inertiaDecay, panBy, wrapLng, zoomBy, type GeoPose } from './geo-camera';

export interface GeoController {
  pose(): GeoPose;
  /** jump there now */
  setPose(p: GeoPose): void;
  /** one continuous flight; `ms` 0 jumps */
  flyTo(p: GeoPose, ms?: number): void;
  /** true while a flight, zoom glide or inertia is still moving */
  moving(): boolean;
  /** advance by dt seconds and place the camera (position, look, clip planes) */
  update(dt: number, camera: PerspectiveCamera, heightPx: number): void;
  dispose(): void;
}

interface Flight { readonly from: GeoPose; readonly to: GeoPose; readonly start: number; readonly ms: number }

const ZOOM_GLIDE = 9; // per second, in log altitude
const KEY_ZOOM = 0.7;

/** Drag to pan, wheel or pinch to zoom, arrows and +/- on the keyboard; altitude from ~25,000 km to 3 km. */
export function createGeoController(el: HTMLElement, initial: GeoPose, reduced: boolean): GeoController {
  let pose: GeoPose = { ...initial, altKm: clampAlt(initial.altKm) };
  let targetAlt = pose.altKm;
  let flight: Flight | null = null;
  let vel = { x: 0, y: 0 };
  let fov = (34 * Math.PI) / 180;
  let height = 800;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  let lastMove = 0;

  const stop = () => { flight = null; vel = { x: 0, y: 0 }; };
  const onDown = (e: PointerEvent) => { el.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); stop(); targetAlt = pose.altKm; };
  const onMove = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const now = performance.now();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinch > 0 && d > 0) { pose = { ...pose, altKm: clampAlt(pose.altKm * (pinch / d)) }; targetAlt = pose.altKm; }
      pinch = d;
      return;
    }
    const dx = e.clientX - prev.x; const dy = e.clientY - prev.y;
    pose = panBy(pose, dx, dy, fov, height);
    const dt = Math.max(1, now - lastMove) / 1000;
    vel = { x: dx / dt, y: dy / dt };
    lastMove = now;
  };
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    pinch = 0;
    if (performance.now() - lastMove > 80 || reduced) vel = { x: 0, y: 0 };
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    flight = null;
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    targetAlt = zoomBy(targetAlt, delta);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = 60;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => { pose = panBy(pose, step, 0, fov, height); }, ArrowRight: () => { pose = panBy(pose, -step, 0, fov, height); },
      ArrowUp: () => { pose = panBy(pose, 0, step, fov, height); }, ArrowDown: () => { pose = panBy(pose, 0, -step, fov, height); },
      '+': () => { targetAlt = clampAlt(targetAlt * KEY_ZOOM); }, '=': () => { targetAlt = clampAlt(targetAlt * KEY_ZOOM); },
      '-': () => { targetAlt = clampAlt(targetAlt / KEY_ZOOM); },
    };
    const fn = moves[e.key];
    if (!fn) return;
    e.preventDefault(); flight = null; fn();
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('keydown', onKey);
  el.style.touchAction = 'none';

  return {
    pose: () => pose,
    setPose(p) { stop(); pose = { lng: wrapLng(p.lng), lat: clampLat(p.lat), altKm: clampAlt(p.altKm) }; targetAlt = pose.altKm; },
    flyTo(p, ms = 4000) {
      const to = { lng: wrapLng(p.lng), lat: clampLat(p.lat), altKm: clampAlt(p.altKm) };
      if (ms <= 0 || reduced) { this.setPose(to); return; }
      stop();
      flight = { from: pose, to, start: performance.now(), ms };
    },
    moving: () => flight !== null || Math.abs(Math.log(targetAlt / pose.altKm)) > 1e-3 || Math.hypot(vel.x, vel.y) > 1,
    update(dt, camera, heightPx) {
      fov = (camera.fov * Math.PI) / 180;
      height = heightPx;
      if (flight) {
        const k = (performance.now() - flight.start) / flight.ms;
        pose = flightPose(flight.from, flight.to, k);
        targetAlt = pose.altKm;
        if (k >= 1) flight = null;
      } else {
        const g = 1 - Math.exp(-ZOOM_GLIDE * dt);
        pose = { ...pose, altKm: Math.exp(Math.log(pose.altKm) + (Math.log(targetAlt) - Math.log(pose.altKm)) * g) };
        if (pointers.size === 0 && Math.hypot(vel.x, vel.y) > 1) {
          pose = panBy(pose, vel.x * dt, vel.y * dt, fov, height);
          const decay = Math.exp(-inertiaDecay(pose.altKm) * dt);
          vel = { x: vel.x * decay, y: vel.y * decay };
        }
      }
      camera.position.copy(lngLatToVec3(pose.lng, pose.lat, 1 + pose.altKm / EARTH_KM));
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      const { near, far } = clipPlanes(pose.altKm);
      if (camera.near !== near || camera.far !== far) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); }
    },
    dispose() {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKey);
    },
  };
}
