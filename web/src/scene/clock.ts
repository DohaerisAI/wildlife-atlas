/** Continuous year clock in months (0 ≤ t < 12). Drives every scene view from one requestAnimationFrame loop. */
export interface Clock {
  readonly time: () => number;
  readonly playing: () => boolean;
  set(t: number): void;
  play(): void;
  pause(): void;
  setSpeed(monthsPerSecond: number): void;
  /** Ease to t over durationMs; used when a month is picked so the scene glides rather than jumps. */
  glideTo(t: number, durationMs: number): void;
  onTick(fn: (t: number, dtSeconds: number) => void): () => void;
  dispose(): void;
}

const DEFAULT_SPEED = 0.35;

export function createClock(start: number, reducedMotion: boolean): Clock {
  let t = start;
  let playing = false;
  let speed = DEFAULT_SPEED;
  let glide: { from: number; to: number; start: number; dur: number } | null = null;
  let last = performance.now();
  let raf = 0;
  const listeners = new Set<(t: number, dt: number) => void>();

  const wrap = (v: number) => ((v % 12) + 12) % 12;

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (glide) {
      const k = Math.min(1, (now - glide.start) / glide.dur);
      const e = 1 - (1 - k) ** 3;
      t = wrap(glide.from + (glide.to - glide.from) * e);
      if (k >= 1) glide = null;
    } else if (playing) {
      t = wrap(t + speed * dt);
    }
    listeners.forEach((fn) => fn(t, dt));
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    time: () => t,
    playing: () => playing,
    set: (v) => { glide = null; t = wrap(v); },
    play: () => { glide = null; playing = true; },
    pause: () => { playing = false; },
    setSpeed: (v) => { speed = v; },
    glideTo: (target, durationMs) => {
      if (reducedMotion) { t = wrap(target); return; }
      let delta = wrap(target) - t;
      if (delta > 6) delta -= 12;
      if (delta < -6) delta += 12;
      glide = { from: t, to: t + delta, start: performance.now(), dur: durationMs };
    },
    onTick: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    dispose: () => { cancelAnimationFrame(raf); listeners.clear(); },
  };
}
