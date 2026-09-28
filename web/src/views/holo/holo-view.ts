import {
  AdditiveBlending, BackSide, Mesh, PerspectiveCamera, Raycaster, Scene, ShaderMaterial, SphereGeometry, Vector2,
  Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { easeInOut } from '../../scene/flow';
import type { CameraTarget, SceneView, SpeciesLayer } from '../../scene/view';
import { EARTH_KM, lngLatToVec3, vec3ToLngLat } from '../../engine/globe/geo';
import { outlineLayer, PALETTE, ParticleLayer, PillarLayer, starField, type Outlines } from './layers';
import { atmosphereFragment, globeFragment, globeVertex } from './shaders';

const MIN_DIST = 1.08;
const MAX_DIST = 7;

interface Flight { from: Vector3; to: Vector3; start: number; dur: number }

export function createHoloView(container: HTMLElement, outlines: Outlines): SceneView {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.01, 200);
  camera.position.copy(lngLatToVec3(80, 20, 3.1));

  const globeUniforms = { uTime: { value: 0 }, uCore: { value: PALETTE.core }, uRim: { value: PALETTE.rim } };
  const globe = new Mesh(new SphereGeometry(1, 128, 96), new ShaderMaterial({ vertexShader: globeVertex, fragmentShader: globeFragment, uniforms: globeUniforms }));
  const atmosphere = new Mesh(new SphereGeometry(1.12, 96, 64), new ShaderMaterial({
    vertexShader: globeVertex, fragmentShader: atmosphereFragment, uniforms: { uRim: { value: PALETTE.rim } },
    side: BackSide, transparent: true, blending: AdditiveBlending, depthWrite: false,
  }));
  scene.add(starField(), atmosphere, globe, outlineLayer(outlines));

  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.06, rotateSpeed: 0.45, zoomSpeed: 0.7, enablePan: false, minDistance: MIN_DIST, maxDistance: MAX_DIST });

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(container.clientWidth, container.clientHeight), 0.7, 0.4, 0.42);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let pillars: PillarLayer | null = null;
  let particles: ParticleLayer | null = null;
  let flight: Flight | null = null;
  let elapsed = 0;

  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.setSize(w, h);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  const raycaster = new Raycaster();
  const pickHandlers: ((lng: number, lat: number) => void)[] = [];
  let downAt: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; flight = null; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
    const hit = raycaster.intersectObject(globe)[0];
    if (hit) { const { lng, lat } = vec3ToLngLat(hit.point); pickHandlers.forEach((fn) => fn(lng, lat)); }
  });

  const clearSpecies = () => {
    for (const layer of [pillars, particles]) layer?.dispose();
    if (pillars) scene.remove(pillars.mesh);
    if (particles) scene.remove(particles.points, particles.trails);
    pillars = particles = null;
  };

  return {
    setSpecies(layer: SpeciesLayer | null) {
      clearSpecies();
      if (!layer) return;
      pillars = new PillarLayer(layer);
      particles = new ParticleLayer(layer, pixelRatio);
      scene.add(pillars.mesh, particles.trails, particles.points);
    },

    update(t: number, dt: number) {
      elapsed += dt;
      globeUniforms.uTime.value = elapsed;
      pillars?.update(t);
      particles?.update(t);
      if (flight) {
        const k = Math.min(1, (performance.now() - flight.start) / flight.dur);
        const e = easeInOut(k);
        const len = flight.from.length() + (flight.to.length() - flight.from.length()) * e;
        camera.position.copy(flight.from).normalize().lerp(flight.to.clone().normalize(), e).normalize().multiplyScalar(len);
        if (k >= 1) flight = null;
      }
      controls.update();
      composer.render();
    },

    flyTo(target: CameraTarget, durationMs: number) {
      const dist = Math.min(MAX_DIST, Math.max(MIN_DIST, 1 + target.altitudeKm / EARTH_KM));
      const to = lngLatToVec3(target.lng, target.lat, dist);
      if (durationMs <= 0) { camera.position.copy(to); flight = null; return; }
      flight = { from: camera.position.clone(), to, start: performance.now(), dur: durationMs };
    },

    camera(): CameraTarget {
      const { lng, lat } = vec3ToLngLat(camera.position);
      return { lng, lat, altitudeKm: (camera.position.length() - 1) * EARTH_KM };
    },

    onPick(cb) { pickHandlers.push(cb); },

    dispose() {
      observer.disconnect();
      clearSpecies();
      controls.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
