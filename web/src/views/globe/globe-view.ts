import { Raycaster, Sphere, Vector2, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createStage } from '../../engine/core/stage';
import { EARTH_KM, lngLatToVec3, vec3ToLngLat } from '../../engine/globe/geo';
import { createGlobe } from '../../engine/globe/globe';
import type { LandMask } from '../../engine/globe/mask';
import { FlowLayer } from '../../engine/layers/flow-layer';
import { createLivingEarth, envCaption, type LivingEarth, type MaterialChannels } from '../../engine/living-earth/materials';
import { easeInOut } from '../../scene/flow';
import type { CameraTarget, SceneView, SpeciesLayer } from '../../scene/view';

const MIN_DIST = 1.08;
const MAX_DIST = 7;
const PICK_SLOP_PX = 5;
const FLOW_COLOR = '#ffb26b';
/** The atlas has no story to set channels, so the environment sits at one calm level. */
const ATLAS_ENV: MaterialChannels = { water: 0.8, snow: 0.8, wind: 0.6 };

interface Flight { readonly from: Vector3; readonly to: Vector3; readonly start: number; readonly dur: number }

export interface GlobeViewRoots { readonly stage: HTMLElement; readonly env: HTMLElement }

/** The atlas globe on the shared engine: dot land, Living Earth materials and one species flow. */
export function createGlobeView(roots: GlobeViewRoots, mask: LandMask): SceneView {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = createStage(roots.stage, { fov: 38 });
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, stage.settings().pixelRatio);
  const globe = createGlobe(mask, stage.settings().landDots, pixelRatio());
  globe.setFocus(0.6);
  stage.scene.add(globe.group);
  stage.camera.position.copy(lngLatToVec3(80, 20, 3.1));

  const controls = new OrbitControls(stage.camera, stage.canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.06, rotateSpeed: 0.45, zoomSpeed: 0.7, enablePan: false, minDistance: MIN_DIST, maxDistance: MAX_DIST });

  let earth: LivingEarth | null = null;
  createLivingEarth(`${import.meta.env.BASE_URL}content/living-earth/v1/`, stage.scene, mask, stage.settings(), stage.renderer.capabilities.maxTextureSize, reduced)
    .then((le) => {
      le.setTier(stage.settings());
      earth = le;
      roots.env.textContent = envCaption(ATLAS_ENV);
      roots.env.title = le.manifest.attribution;
    })
    .catch((err) => console.warn('Living Earth pack unavailable; the globe shows land only', err));

  let flow: FlowLayer | null = null;
  let flight: Flight | null = null;
  let month = 0;

  stage.onTier((_t, s) => { globe.rebuildDots(s.landDots, pixelRatio()); earth?.setTier(s); });
  stage.onFrame(({ time, dt }) => {
    if (flight) {
      const k = Math.min(1, (performance.now() - flight.start) / flight.dur);
      const e = easeInOut(k);
      const len = flight.from.length() + (flight.to.length() - flight.from.length()) * e;
      stage.camera.position.copy(flight.from).normalize().lerp(flight.to.clone().normalize(), e).normalize().multiplyScalar(len);
      if (k >= 1) flight = null;
    }
    controls.update();
    globe.update(time);
    earth?.update(month, time, dt, ATLAS_ENV, stage.camera);
  });

  const raycaster = new Raycaster();
  const surface = new Sphere(new Vector3(), 1);
  const hit = new Vector3();
  const pickHandlers: ((lng: number, lat: number) => void)[] = [];
  let downAt: { x: number; y: number } | null = null;
  stage.canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; flight = null; });
  stage.canvas.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > PICK_SLOP_PX) return;
    const rect = stage.canvas.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), stage.camera);
    if (!raycaster.ray.intersectSphere(surface, hit)) return;
    const { lng, lat } = vec3ToLngLat(hit);
    pickHandlers.forEach((fn) => fn(lng, lat));
  });

  const clearSpecies = () => {
    if (!flow) return;
    stage.scene.remove(flow.group);
    flow.dispose();
    flow = null;
  };

  return {
    setSpecies(layer: SpeciesLayer | null) {
      clearSpecies();
      if (!layer) return;
      flow = new FlowLayer(layer.flow, FLOW_COLOR, pixelRatio());
      stage.scene.add(flow.group);
    },

    update(t: number) {
      month = t;
      flow?.update(t);
    },

    flyTo(target: CameraTarget, durationMs: number) {
      const dist = Math.min(MAX_DIST, Math.max(MIN_DIST, 1 + target.altitudeKm / EARTH_KM));
      const to = lngLatToVec3(target.lng, target.lat, dist);
      if (durationMs <= 0) { stage.camera.position.copy(to); flight = null; return; }
      flight = { from: stage.camera.position.clone(), to, start: performance.now(), dur: durationMs };
    },

    camera(): CameraTarget {
      const { lng, lat } = vec3ToLngLat(stage.camera.position);
      return { lng, lat, altitudeKm: (stage.camera.position.length() - 1) * EARTH_KM };
    },

    onPick(cb) { pickHandlers.push(cb); },

    dispose() {
      clearSpecies();
      earth?.dispose();
      globe.dispose();
      controls.dispose();
      stage.dispose();
    },
  };
}
