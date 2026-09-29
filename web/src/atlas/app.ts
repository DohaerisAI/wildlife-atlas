import { loadCell, loadCells, loadMeta, loadRange, loadSpeciesIndex } from '../data';
import { MONTH_LONG } from '../constants';
import { loadMask } from '../engine/globe/mask';
import { envCaption } from '../engine/living-earth/materials';
import { buildFlow, type FlowField } from '../scene/flow';
import { createClock } from '../scene/clock';
import { flockCenter, glide, toLngLat, toVec, type Vec3 } from '../scene/follow';
import { loadProfile, type SpeciesProfile } from '../species/profile';
import type { CellDetail, SpeciesIndexEntry } from '../types';
import { h } from '../ui/dom';
import { cellIdAt, toMonth } from '../url-state';
import { reversePlace } from './geocode';
import { createAtlasGlobe } from './globe';
import { placeSummary } from './place-summary';
import { loadProfileIndex, thumbFor } from './profile-index';
import { speciesSummary, type SpeciesSummary } from './species-summary';
import { createStore, monthOf, type AtlasState, type Place } from './store';
import { fmtLat, fmtLng } from './ui/bits';
import { legendPanel } from './ui/legend';
import { createPanel } from './ui/panel';
import { placeView } from './ui/place-view';
import { createProbe } from './ui/probe';
import { searchBox } from './ui/search';
import { speciesView } from './ui/species-view';
import { createTimeline } from './ui/timeline';

const DEFAULT_SPECIES = 'falco amurensis';
const PARTICLES = 5000;
const PANEL_W = 420;
const URL_SYNC_MS = 1000;
const PLACE_ALT_KM = 2600;
const SPECIES_ALT_KM = 9000;
/** The atlas has no chapters to set channels: every material at one calm level. */
const ENV = { water: 0.8, snow: 0.8, wind: 0.55, land: 1, currents: 0.8, blooms: 0.9, lights: 1, depth: 1 };

export interface AtlasRoots { stage: HTMLElement; pins: HTMLElement; ui: HTMLElement; banner: HTMLElement; env: HTMLElement }

interface SpeciesData { entry: SpeciesIndexEntry; flow: FlowField; summary: SpeciesSummary; profile: SpeciesProfile | null }

const wide = () => window.matchMedia('(min-width: 900px)').matches;

export async function startAtlas(roots: AtlasRoots): Promise<void> {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const q = new URLSearchParams(location.search);
  const [meta, cells, index, mask, profiles] = await Promise.all([loadMeta(), loadCells(), loadSpeciesIndex(), loadMask(`${import.meta.env.BASE_URL}geo/land-mask.png`), loadProfileIndex()]);
  roots.banner.hidden = !meta.source.demo;
  const byKey = new Map(index.map((s) => [s.k, s]));
  const cellSet = new Set(cells.cells.map((c) => c.id));
  const coverage = new Map(cells.cells.map((c) => [c.id, c.coverage]));
  const thumbOf = (sci: string) => thumbFor(profiles, sci);

  const month = toMonth(q.get('m'), (new Date().getMonth() + 1) as 1);
  const store = createStore({ t: month - 1 + 0.5, playing: false, species: null, place: null, panel: null, follow: false });
  const globe = createAtlasGlobe(roots.stage, roots.pins, mask, reduced);
  globe.setEnvironment(ENV);
  globe.onEarth((le) => { roots.env.textContent = le.hasWorld ? `${envCaption(ENV)} · Land (ESA WorldCover) · Ocean (HYCOM, MODIS-Aqua) · Lights (VIIRS)` : envCaption(ENV); });
  const clock = createClock(store.get().t, reduced);

  // ---------- chrome ----------
  const where = h('p', { class: 'where' });
  const legendSlot = h('div', { class: 'legend-slot' });
  const toggleLegend = () => { if (legendSlot.firstChild) legendSlot.replaceChildren(); else legendSlot.replaceChildren(legendPanel(() => legendSlot.replaceChildren())); };
  const top = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: './' }, 'Wildlife Atlas'),
    searchBox(index, thumbOf, { onSpecies: (k) => void selectSpecies(k, true), onPlace: (p) => pickPlace(p.lng, p.lat, { name: p.label, detail: p.detail }) }),
    where,
    h('nav', { class: 'top-links' },
      h('button', { class: 'btn-quiet', type: 'button', onclick: toggleLegend, 'aria-label': 'What am I seeing?' }, 'Legend'),
      h('a', { class: 'btn-quiet', href: './' }, 'Story'),
      h('a', { class: 'btn-quiet', href: 'map.html' }, 'Map')));
  const timeline = createTimeline({
    onScrub: (t) => { clock.pause(); clock.set(t); },
    onMonth: (m) => { clock.pause(); clock.glideTo(m - 1 + 0.5, reduced ? 0 : 900); },
    onTogglePlay: () => { if (clock.playing()) clock.pause(); else { clock.play(); store.set({ follow: true }); } },
  });
  const probe = createProbe();
  const panel = createPanel((v) => store.set({ panel: v }), () => store.set({ panel: null }));
  const follow = h('button', { class: 'chip follow', type: 'button', 'aria-pressed': 'false', onclick: () => store.set({ follow: !store.get().follow }) }, 'Follow the flock');
  const followingBtn = h('button', { class: 'chip following', type: 'button', onclick: () => store.set({ panel: 'species' }) }, 'Following');
  roots.ui.append(top, legendSlot, panel.element, h('div', { class: 'dock' }, h('div', { class: 'dock-row' }, followingBtn, follow), timeline.element), probe.element);

  // ---------- species ----------
  let species: SpeciesData | null = null;
  let speciesToken = 0;
  async function selectSpecies(key: string, fly: boolean) {
    const entry = byKey.get(key);
    if (!entry) return;
    const token = ++speciesToken;
    store.set({ species: key, panel: fly || wide() ? 'species' : store.get().panel });
    try {
      const [range, profile] = await Promise.all([loadRange(key), loadProfile(entry.sci).catch((err) => { console.warn('Profile unavailable', entry.sci, err); return null; })]);
      if (token !== speciesToken) return;
      const flow = buildFlow(range, cells.cellSize, PARTICLES, 11);
      species = { entry, flow, summary: speciesSummary(range, cells.cellSize), profile };
      globe.setFlow(flow);
      timeline.setCurve(species.summary.presence, `${entry.name || entry.sci} · recorded presence through the year`);
      if (fly) {
        const c = species.summary.centres[monthOf(store.get().t) - 1];
        if (c) globe.flyTo({ lng: c.lng, lat: c.lat, altitudeKm: SPECIES_ALT_KM });
      }
      render();
    } catch (err) {
      console.error('Species failed to load', key, err);
      species = null;
      globe.setFlow(null);
      render();
    }
  }

  // ---------- place ----------
  let cell: CellDetail | null = null;
  let cellStatus: 'loading' | 'ready' | 'none' | 'error' = 'none';
  let placeToken = 0;
  function pickPlace(lng: number, lat: number, named: { name: string; detail: string } | null = null, fly = true) {
    const id = cellIdAt(lng, lat, cells.cellSize);
    const cellId = cellSet.has(id) ? id : null;
    const place: Place = { lng, lat, cellId, name: named?.name ?? null, detail: named?.detail ?? null };
    const token = ++placeToken;
    cell = null;
    cellStatus = cellId ? 'loading' : 'none';
    store.set({ place, panel: 'place' });
    globe.setPlace({ lng, lat, label: named?.name ?? `${fmtLat(lat)} ${fmtLng(lng)}` });
    if (fly) globe.flyTo({ lng, lat, altitudeKm: Math.min(globe.camera().altitudeKm, PLACE_ALT_KM) });
    if (!named) reversePlace(lng, lat).then((n) => {
      if (!n || token !== placeToken) return;
      store.set({ place: { ...store.get().place!, name: n.name, detail: n.detail } });
      globe.setPlace({ lng, lat, label: n.name });
    });
    if (cellId) loadCell(cellId).then((c) => { if (token === placeToken) { cell = c; cellStatus = 'ready'; render(); } })
      .catch((err) => { console.error('Cell failed to load', cellId, err); if (token === placeToken) { cellStatus = 'error'; render(); } });
  }

  // ---------- render ----------
  const tabLabel = (s: AtlasState) => ({
    place: s.place ? (s.place.name ?? 'This place') : null,
    species: species ? (species.profile?.name || species.entry.name || species.entry.sci) : s.species ? 'Species' : null,
  });
  function render() {
    const s = store.get();
    const m = monthOf(s.t) - 1;
    where.textContent = `${s.place?.name ?? 'The whole planet'} · ${MONTH_LONG[m]}`;
    follow.setAttribute('aria-pressed', String(s.follow));
    const open = s.panel !== null && (s.panel === 'place' ? s.place !== null : s.species !== null);
    document.body.classList.toggle('panel-open', open);
    globe.setInset(open && wide() ? PANEL_W : 0, open && !wide() ? window.innerHeight * 0.46 : 0);
    followingBtn.textContent = species ? `Following · ${species.profile?.name || species.entry.name || species.entry.sci}` : 'Following';
    if (!open) { panel.close(); return; }
    if (s.panel === 'place' && s.place) {
      panel.show('place', tabLabel(s), placeView({
        place: s.place, month: m, status: cellStatus, summary: cell ? placeSummary(cell, (m + 1) as 1) : null,
        coverage: s.place.cellId ? coverage.get(s.place.cellId)?.[m] ?? null : null,
        env: globe.sample(s.place.lng, s.place.lat), species: byKey, thumbOf,
      }, { onSpecies: (k) => void selectSpecies(k, false), onMonth: (mm) => timelineMonth(mm) }));
    } else if (s.panel === 'species') {
      const entry = s.species ? byKey.get(s.species) : null;
      if (!entry) return;
      panel.show('species', tabLabel(s), species && species.entry.k === entry.k
        ? speciesView({ entry, profile: species.profile, summary: species.summary, month: m, meta }, {
          onJourney: (lng, lat) => globe.flyTo({ lng, lat, altitudeKm: SPECIES_ALT_KM }),
          onMonth: (mm) => timelineMonth(mm),
        })
        : h('p', { class: 'na pad' }, `Loading ${entry.name || entry.sci}…`));
    }
  }
  const timelineMonth = (m: number) => { clock.pause(); clock.glideTo(m - 1 + 0.5, reduced ? 0 : 900); };
  store.subscribe((s, prev) => {
    if (monthOf(s.t) !== monthOf(prev.t) || s.panel !== prev.panel || s.place !== prev.place || s.species !== prev.species || s.follow !== prev.follow) render();
  });

  // ---------- globe input ----------
  globe.onPick((lng, lat) => { probe.hide(); pickPlace(lng, lat, null, false); });
  globe.onDrag(() => { if (store.get().follow) store.set({ follow: false }); });
  globe.onHover((at) => {
    if (!at) { probe.hide(); return; }
    probe.show(at.x, at.y, at.lng, at.lat, monthOf(store.get().t) - 1, globe.sample(at.lng, at.lat));
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') store.set({ panel: null }); });

  // ---------- time ----------
  let followVec: Vec3 | null = null;
  const scratch = { buf: new Float32Array(0) };
  clock.onTick((t, dt) => {
    globe.setMonth(t);
    timeline.set(t, clock.playing());
    if (store.get().playing !== clock.playing()) store.set({ playing: clock.playing() });
    store.set({ t });
    const s = store.get();
    if (s.follow && species) {
      if (scratch.buf.length !== species.flow.count * 3) scratch.buf = new Float32Array(species.flow.count * 3);
      const target = flockCenter(species.flow, t, scratch.buf);
      if (target) {
        const cam = globe.camera();
        followVec = glide(followVec ?? toVec(cam.lng, cam.lat), target, dt);
        const { lng, lat } = toLngLat(followVec);
        globe.flyTo({ lng, lat, altitudeKm: cam.altitudeKm }, 0);
      }
    } else followVec = null;
  });

  // ---------- URL ----------
  window.setInterval(() => {
    const s = store.get();
    const cam = globe.camera();
    const p = new URLSearchParams();
    p.set('m', String(monthOf(s.t)));
    if (s.species) p.set('sp', s.species);
    if (s.place) p.set('place', `${s.place.lng.toFixed(3)},${s.place.lat.toFixed(3)}`);
    p.set('at', `${cam.lng.toFixed(2)},${cam.lat.toFixed(2)},${Math.round(cam.altitudeKm)}`);
    history.replaceState(null, '', `atlas.html?${p.toString()}`);
  }, URL_SYNC_MS);

  // ---------- start ----------
  const [lng, lat, alt] = (q.get('at') ?? '').split(',').map(Number);
  const portrait = window.innerWidth < window.innerHeight * 0.8;
  if ([lng, lat, alt].every(Number.isFinite)) globe.flyTo({ lng: lng!, lat: lat!, altitudeKm: alt! }, 0);
  else globe.flyTo({ lng: 80, lat: 20, altitudeKm: portrait ? 40000 : 19000 }, 0);
  const requested = q.get('sp');
  const start = (requested && byKey.has(requested) ? requested : null) ?? index.find((s) => s.sci.toLowerCase() === DEFAULT_SPECIES)?.k ?? index[0]?.k;
  if (start) void selectSpecies(start, false);
  const [pl, pa] = (q.get('place') ?? '').split(',').map(Number);
  if (Number.isFinite(pl) && Number.isFinite(pa) && Math.abs(pa!) <= 90) pickPlace(pl!, pa!, null, false);
  render();
}
