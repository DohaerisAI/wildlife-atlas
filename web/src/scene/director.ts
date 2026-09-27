import type { Story } from '../stories';
import type { Clock } from './clock';
import { zoomToAltitudeKm, type SceneView } from './view';

export const STEP_MS = 7500;
const FLY_MS = 3600;
const GLIDE_MS = 3000;

export interface DirectorEvents {
  onStep: (story: Story, index: number) => void;
  onEnd: () => void;
}

/** Plays a story: each step flies the camera, glides time to the step's month and auto-advances. */
export function createDirector(view: SceneView, clock: Clock, pitch: number, events: DirectorEvents) {
  let current: { story: Story; index: number } | null = null;
  let timer: number | undefined;
  let auto = true;

  const go = (index: number) => {
    if (!current) return;
    window.clearTimeout(timer);
    const step = current.story.steps[index];
    if (!step) return stop();
    current = { ...current, index };
    const [lng, lat, zoom] = step.camera ?? [...current.story.center, current.story.zoom];
    view.flyTo({ lng, lat, altitudeKm: zoomToAltitudeKm(zoom), pitch }, FLY_MS);
    clock.pause();
    clock.glideTo(step.month - 1 + 0.5, GLIDE_MS);
    events.onStep(current.story, index);
    if (auto) timer = window.setTimeout(() => go(index + 1), STEP_MS);
  };

  const stop = () => {
    window.clearTimeout(timer);
    if (current) { current = null; events.onEnd(); }
  };

  return {
    start(story: Story) { auto = true; current = { story, index: 0 }; go(0); },
    next() { if (current) go(current.index + 1); },
    holdAuto() { auto = false; window.clearTimeout(timer); },
    stop,
    active: () => current !== null,
  };
}
