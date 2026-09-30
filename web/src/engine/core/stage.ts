import { HalfFloatType, PerspectiveCamera, Scene, Vector2, WebGLRenderer, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { TIERS, initialTier, sampleFrame, startBudget, type BudgetState, type Tier, type TierSettings } from './tiers';

export interface Frame {
  /** seconds since the stage started */
  readonly time: number;
  /** seconds since the previous frame, capped */
  readonly dt: number;
}

export interface Stage {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  tier(): Tier;
  settings(): TierSettings;
  onFrame(fn: (f: Frame) => void): () => void;
  onTier(fn: (tier: Tier, s: TierSettings) => void): () => void;
  size(): { width: number; height: number };
  /** stop drawing (and ticking layers) while something else covers the stage */
  setActive(on: boolean): void;
  dispose(): void;
}

const MAX_DT = 0.1;

/** Renderer, bloom, one frame loop and automatic quality tiers for a full-bleed container. */
export function createStage(container: HTMLElement, opts: { fov?: number } = {}): Stage {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  let budget: BudgetState = startBudget(initialTier(coarse));

  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.setClearColor(0x02070d, 1);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';

  const scene = new Scene();
  const camera = new PerspectiveCamera(opts.fov ?? 34, 1, 0.01, 200);
  // the composer's default target has no stencil; tile land is masked in it (layers/stencil.ts)
  const composer = new EffectComposer(renderer, new WebGLRenderTarget(1, 1, { type: HalfFloatType, stencilBuffer: true }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.55, 0.4, 0.55);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const frameFns = new Set<(f: Frame) => void>();
  const tierFns = new Set<(t: Tier, s: TierSettings) => void>();
  let width = 1;
  let height = 1;

  const applyTier = () => {
    const s = TIERS[budget.tier];
    const dpr = Math.min(window.devicePixelRatio || 1, s.pixelRatio);
    renderer.setPixelRatio(dpr);
    composer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    bloom.enabled = s.bloom;
    tierFns.forEach((fn) => fn(budget.tier, s));
  };

  const resize = () => {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.domElement.style.width = `${width}px`;
    renderer.domElement.style.height = `${height}px`;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    applyTier();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const start = performance.now();
  let last = start;
  let raf = 0;
  let active = true;
  const loop = (now: number) => {
    if (!active) { last = now; raf = requestAnimationFrame(loop); return; }
    const frameMs = now - last;
    last = now;
    const next = sampleFrame(budget, frameMs);
    const changed = next.tier !== budget.tier;
    budget = next;
    if (changed) applyTier();
    const f: Frame = { time: (now - start) / 1000, dt: Math.min(MAX_DT, frameMs / 1000) };
    frameFns.forEach((fn) => fn(f));
    composer.render();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return {
    renderer, scene, camera, canvas: renderer.domElement,
    tier: () => budget.tier,
    settings: () => TIERS[budget.tier],
    onFrame: (fn) => { frameFns.add(fn); return () => frameFns.delete(fn); },
    onTier: (fn) => { tierFns.add(fn); return () => tierFns.delete(fn); },
    size: () => ({ width, height }),
    setActive: (on) => { active = on; },
    dispose: () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      frameFns.clear();
      tierFns.clear();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
