import { loadCells, loadMeta, loadRange, loadSpeciesIndex } from '../data';
import { MONTH_LONG } from '../constants';
import { createStage } from '../engine/core/stage';
import { applyPose, dampPose, type CameraPose } from '../engine/globe/camera-rig';
import { createGlobe } from '../engine/globe/globe';
import { loadMask } from '../engine/globe/mask';
import { FlowLayer } from '../engine/layers/flow-layer';
import { LabelLayer } from '../engine/layers/labels';
import { TrackLayer } from '../engine/layers/track-layer';
import { buildFlow } from '../scene/flow';
import { stateAt } from '../story/interpolate';
import { mountStory } from '../story/runtime';
import type { Story } from '../story/schema';
import { CHIULON, CHIULON_PATH } from '../stories/chiulon';
import { loadProfile } from '../species/profile';
import { speciesCard, speciesDrawer } from '../ui/species-card';
import type { SpeciesIndexEntry } from '../types';

/** Supporting cast for the cold open, in fixed colour order. The story's own species is always amber. */
const CAST = ['Anser indicus', 'Clamator jacobinus', 'Pastor roseus', 'Grus virgo', 'Motacilla cinerea', 'Oriolus kundoo', 'Merops philippinus', 'Phoenicopterus roseus'];
const CAST_COLORS = ['#62d6f2', '#73f0b8', '#b9ef72', '#d9f2ff', '#8fb8ff', '#62d6f2', '#73f0b8', '#b9ef72'];
const FOCAL_COLOR = '#ffb26b';
const TRACK_COLOR = '#ffe2c4';
const mid = (d: Date) => d.getMonth() + (d.getDate() - 0.5) / 31;

export interface StoryPageRoots { stage: HTMLElement; story: HTMLElement; pins: HTMLElement; month: HTMLElement; progress: HTMLElement; banner: HTMLElement; about: HTMLButtonElement }

/** Cold open uses today's date; every other chapter comes from the story data. */
function withToday(story: Story, today: Date): Story {
  const [first, ...rest] = story.chapters;
  return { ...story, chapters: [{ ...first!, month: mid(today), kicker: `Right now · ${today.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}` }, ...rest] };
}

export async function startStoryPage(roots: StoryPageRoots): Promise<void> {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const story = withToday(CHIULON, new Date());
  const [meta, cells, index, mask] = await Promise.all([loadMeta(), loadCells(), loadSpeciesIndex(), loadMask(`${import.meta.env.BASE_URL}geo/land-mask.png`)]);
  roots.banner.hidden = !meta.source.demo;

  const stage = createStage(roots.stage);
  const settings = stage.settings();
  const dpr = Math.min(window.devicePixelRatio || 1, settings.pixelRatio);
  const globe = createGlobe(mask, settings.landDots, dpr);
  stage.scene.add(globe.group);

  const bySci = new Map<string, SpeciesIndexEntry>(index.map((s) => [s.sci.toLowerCase(), s]));
  const loadFlow = async (sci: string, color: string, count: number) => {
    const entry = bySci.get(sci.toLowerCase());
    if (!entry) return null;
    try {
      const range = await loadRange(entry.k);
      const layer = new FlowLayer(buildFlow(range, cells.cellSize, count, 11), color, dpr);
      stage.scene.add(layer.group);
      return layer;
    } catch (err) {
      console.warn(`Skipping ${sci}: range unavailable`, err);
      return null;
    }
  };
  const focal = await loadFlow(story.species, FOCAL_COLOR, settings.particles);
  const cast = (await Promise.all(CAST.map((sci, i) => loadFlow(sci, CAST_COLORS[i]!, Math.round(settings.particles * 0.3))))).filter((l): l is FlowLayer => l !== null);

  const track = new TrackLayer(CHIULON_PATH, TRACK_COLOR, dpr);
  stage.scene.add(track.group);
  const labels = new LabelLayer(roots.pins);
  story.chapters.forEach((c) => c.pins?.forEach((p) => labels.upsert(p.id, p.text, p.lng, p.lat, p.kind)));
  labels.upsert('chiulon', 'Chiulon', ...CHIULON_PATH.at(0), 'animal');

  const runtime = mountStory(roots.story, story, reduced);
  loadProfile(story.species).then((profile) => {
    if (!profile) return;
    runtime.profileSlots().forEach((slot) => slot.replaceChildren(speciesCard(profile)));
    const drawer = speciesDrawer(profile);
    document.body.append(drawer.element);
    roots.about.textContent = `About the ${profile.name}`;
    roots.about.hidden = false;
    roots.about.addEventListener('click', drawer.open);
  }).catch((err) => console.warn('Species profile unavailable', err));
  const first = story.chapters[0]!;
  let pose: CameraPose = { ...first.camera };
  let lastMonth = -1;

  stage.onTier((_t, s) => globe.rebuildDots(s.landDots, Math.min(window.devicePixelRatio || 1, s.pixelRatio)));
  stage.onFrame(({ time, dt }) => {
    const st = stateAt(story, runtime.position());
    const target: CameraPose = { lng: st.lng, lat: st.lat, altKm: st.altKm, frameX: window.innerWidth < 760 ? 0 : st.frameX };
    pose = reduced ? target : dampPose(pose, target, dt, 4);
    const { width, height } = stage.size();
    applyPose(stage.camera, pose, width, height);

    globe.update(time);
    const ch = st.channels;
    focal?.setOpacity(ch.flock ?? 0);
    focal?.update(st.month);
    cast.forEach((l) => { l.setOpacity((ch.others ?? 0) * 0.6); l.update(st.month); });
    const trackOn = Math.min(1, (ch.track ?? 0) * 40);
    track.set(ch.track ?? 0, trackOn);

    story.chapters.forEach((c, i) => c.pins?.forEach((p) => labels.setOpacity(p.id, i === st.chapter ? 1 : 0)));
    labels.upsert('chiulon', 'Chiulon', ...track.headLngLat(), 'animal');
    labels.setOpacity('chiulon', trackOn);
    labels.update(stage.camera, width, height);
    runtime.updateCounters(st.chapter, ch);

    const m = Math.floor(st.month);
    if (m !== lastMonth) { lastMonth = m; roots.month.textContent = MONTH_LONG[m] ?? ''; }
    roots.progress.style.transform = `scaleX(${(runtime.position() / (story.chapters.length - 1)).toFixed(4)})`;
  });
}
