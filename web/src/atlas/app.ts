import { loadCell, loadCells, loadCoverage, loadMeta, loadRange, loadSpeciesIndex } from '../data';
import { INDIA_ONLY, noListNote } from './coverage';
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
import { altitudeForZoom, locateMe } from './locate';
import type { SpeciesRange } from '../types';
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
import { createTimeline, todayT } from './ui/timeline';
import { follow as followSpecies, unfollow, MAX_FOLLOWED, type Followed } from './follow-list';
import { filterRows, type PlaceFilter } from './ui/place-view';
import { monthlyRegions, type MonthPlace } from './regions';
import { citation, download, placeCsv, speciesCsv } from './research';

const PARTICLES = 5000;
const PANEL_W = 420;
const URL_SYNC_MS = 1000;
const PLACE_ALT_KM = 2600;
const SPECIES_ALT_KM = 9000;
/** The atlas has no chapters to set channels: every material at one calm level. */
const ENV = { water: 0.8, snow: 0.8, wind: 0.55, land: 1, currents: 0.8, blooms: 0.9, lights: 1, depth: 1 };

export interface AtlasRoots { stage: HTMLElement; pins: HTMLElement; ui: HTMLElement; banner: HTMLElement; env: HTMLElement }

/** "Show on map" and Locate me come down to town height: one engine from space to street (decision 0010). */
const TOWN_ALT_KM = 40;

/** India's 1° cells (from the India-country fetch), so regions can say "India" once lists go worldwide. */
async function loadIndiaCells(): Promise<Set<string> | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}geo/india-cells.json`);
    return res.ok ? new Set((await res.json()) as string[]) : null;
  } catch (err) {
    console.warn('India cell list unavailable', err);
    return null;
  }
}

interface SpeciesData { entry: SpeciesIndexEntry; flowFor: (particles: number) => FlowField; summary: SpeciesSummary; profile: SpeciesProfile | null; range: SpeciesRange; regions: { months: MonthPlace[]; india: number[] } }

const wide = () => window.matchMedia('(min-width: 900px)').matches;

export async function startAtlas(roots: AtlasRoots): Promise<void> {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const q = new URLSearchParams(location.search);
  const [meta, cells, index, mask, profiles, manifest, indiaCells] = await Promise.all([loadMeta(), loadCells(), loadSpeciesIndex(), loadMask(`${import.meta.env.BASE_URL}geo/land-mask.png`), loadProfileIndex(), loadCoverage(), loadIndiaCells()]);
  roots.banner.hidden = !meta.source.demo;
  const byKey = new Map(index.map((s) => [s.k, s]));
  const cellSet = new Set(cells.cells.map((c) => c.id));
  const coverageInfo = manifest ?? INDIA_ONLY;
  // Species lists can now reach beyond India, so "in India" comes from India's own cell list, not the grid.
  const isIndia = indiaCells ? (id: string) => indiaCells.has(id) : (id: string) => cellSet.has(id);
  const coverage = new Map(cells.cells.map((c) => [c.id, c.coverage]));
  const thumbOf = (sci: string) => thumbFor(profiles, sci);

  const month = toMonth(q.get('m'), (new Date().getMonth() + 1) as 1);
  const store = createStore({ t: month - 1 + 0.5, playing: false, species: null, place: null, panel: null, follow: false });
  const globe = createAtlasGlobe(roots.stage, roots.pins, mask, reduced, cells.cellSize);
  globe.setEnvironment(ENV);
  // true colour (MODIS worldwide, Sentinel-2 at town sites) is the default look; off shows the land-class colours
  let realColour = q.get('real') !== '0';
  let packCredit = '';
  let hasWorld = false;
  // every layer on screen names its dataset ("Real" law); in real colour the land is MODIS and JRC water is off
  const showCredits = () => {
    const env = envCaption(realColour ? { ...ENV, water: 0 } : ENV);
    const land = realColour ? 'Land colour (MODIS MCD43A4)' : 'Land (ESA WorldCover)';
    roots.env.textContent = hasWorld ? [env, land, 'Ocean (HYCOM, MODIS-Aqua)', 'Lights (VIIRS)'].filter(Boolean).join(' · ') : env;
  };
  globe.onEarth((le) => { packCredit = le.manifest.attribution; hasWorld = le.hasWorld; showCredits(); });
  const clock = createClock(store.get().t, reduced);

  // ---------- chrome ----------
  const where = h('p', { class: 'where' });
  const toast = h('p', { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: true });
  let toastTimer = 0;
  const say = (text: string) => { toast.textContent = text; toast.hidden = false; window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { toast.hidden = true; }, 5000); };
  const locateBtn = h('button', { class: 'btn-quiet locate', type: 'button', 'aria-label': 'Show wildlife where I am', onclick: () => {
    locateBtn.classList.add('is-busy');
    say('Finding where you are…');
    locateMe().then((p) => { toast.hidden = true; pickPlace(p.lng, p.lat, null, true, true); })
      .catch((err) => say((err as Error).message))
      .finally(() => locateBtn.classList.remove('is-busy'));
  } }, 'Locate me');
  const realBtn = h('button', { class: 'btn-quiet', type: 'button', 'aria-pressed': String(realColour), onclick: () => {
    realColour = !realColour;
    globe.setRealColour(realColour);
    showCredits();
    realBtn.setAttribute('aria-pressed', String(realColour));
  } }, 'Real colour');
  globe.setRealColour(realColour);
  const legendSlot = h('div', { class: 'legend-slot' });
  const toggleLegend = () => { if (legendSlot.firstChild) legendSlot.replaceChildren(); else legendSlot.replaceChildren(legendPanel(() => legendSlot.replaceChildren(), meta, realColour ? `${packCredit} · Land colour: MODIS MCD43A4 (NASA LP DAAC)` : packCredit)); };
  const top = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: './' }, 'Wildlife Atlas'),
    searchBox(index, thumbOf, { onSpecies: (k) => void selectSpecies(k, true), onPlace: (p) => pickPlace(p.lng, p.lat, { name: p.label, detail: p.detail }, true, true) }),
    where,
    h('nav', { class: 'top-links' },
      locateBtn,
      realBtn,
      h('button', { class: 'btn-quiet', type: 'button', onclick: toggleLegend, 'aria-label': 'What am I seeing?' }, 'Legend'),
      h('a', { class: 'btn-quiet hide-narrow', href: './' }, 'Story')));
  const timeline = createTimeline({
    onScrub: (t) => { clock.pause(); clock.set(t); },
    onMonth: (m) => { clock.pause(); clock.glideTo(m - 1 + 0.5, reduced ? 0 : 900); },
    onTogglePlay: () => { if (clock.playing()) clock.pause(); else { clock.play(); store.set({ follow: true }); } },
    onStep: (dir) => stepMonth(dir),
    onToday: () => { clock.pause(); clock.glideTo(todayT(), reduced ? 0 : 900); },
  });
  const stepMonth = (dir: -1 | 1) => { clock.pause(); const m = Math.floor(clock.time()); clock.glideTo((((m + dir) % 12) + 12) % 12 + 0.5, reduced ? 0 : 600); };
  const probe = createProbe();
  const panel = createPanel((v) => store.set({ panel: v }), () => store.set({ panel: null }));
  const follow = h('button', { class: 'chip follow', type: 'button', 'aria-pressed': 'false', onclick: () => store.set({ follow: !store.get().follow }) }, 'Follow the flock');
  const followingRow = h('div', { class: 'following-row', role: 'list', 'aria-label': 'Species on the globe' });
  roots.ui.append(top, toast, legendSlot, panel.element, h('div', { class: 'dock' }, h('div', { class: 'dock-row' }, followingRow, follow), timeline.element), probe.element);

  // ---------- species ----------
  // up to three species on the globe, each in its own colour; the first is the one the panel shows
  let followed: Followed[] = [];
  const loaded = new Map<string, SpeciesData>();
  let species: SpeciesData | null = null;
  let speciesFailed: string | null = null;
  let speciesToken = 0;
  const colorOf = (key: string) => followed.find((f) => f.key === key)?.color ?? '#ffb26b';
  const nameOf = (e: SpeciesIndexEntry, p?: SpeciesProfile | null) => p?.name || e.name || e.sci;

  /** push the followed list to the globe, the map, the timeline and the chips */
  function syncFollowed() {
    species = followed[0] ? loaded.get(followed[0].key) ?? null : null;
    const per = Math.round(PARTICLES / Math.max(1, followed.length) * (followed.length > 1 ? 1.3 : 1));
    globe.setFlows(followed.flatMap((f) => { const d = loaded.get(f.key); return d ? [{ key: `${f.key}:${per}`, flow: d.flowFor(per), color: f.color }] : []; }));
    globe.setRange(species?.range ?? null, followed[0]?.color);
    timeline.setCurve(species?.summary.presence ?? null, species ? `${nameOf(species.entry, species.profile)} · recorded presence through the year` : '', followed[0]?.color);
    followingRow.replaceChildren(...followed.map((f) => {
      const d = loaded.get(f.key);
      const e = byKey.get(f.key);
      const label = e ? nameOf(e, d?.profile) : f.key;
      return h('span', { class: `fchip-follow${f.key === followed[0]?.key ? ' is-primary' : ''}`, role: 'listitem', style: `--sp:${f.color}` },
        h('button', { class: 'ff-name', type: 'button', onclick: () => void selectSpecies(f.key, false), title: `Show ${label}` }, h('i', { 'aria-hidden': 'true' }), label),
        followed.length > 1 ? h('button', { class: 'ff-x', type: 'button', 'aria-label': `Stop showing ${label}`, onclick: () => { followed = unfollow(followed, f.key); store.set({ species: followed[0]?.key ?? null }); syncFollowed(); render(); } }, '×') : null);
    }), followed.length < MAX_FOLLOWED ? h('span', { class: 'ff-hint' }, 'Search to add a species') : '');
  }

  /** `open`: show the species panel (a pick or a shared link does; the default species on load does not) */
  async function selectSpecies(key: string, fly: boolean, open = fly || wide()) {
    const entry = byKey.get(key);
    if (!entry) return;
    const token = ++speciesToken;
    speciesFailed = null;
    if (fly) store.set({ follow: false });
    followed = followSpecies(followed, key);
    store.set({ species: key, panel: open ? 'species' : store.get().panel });
    try {
      if (!loaded.has(key)) {
        const [range, profile] = await Promise.all([loadRange(key), loadProfile(entry.sci).catch((err) => { console.warn('Profile unavailable', entry.sci, err); return null; })]);
        const flows = new Map<number, FlowField>();
        loaded.set(key, {
          entry, profile, range, summary: speciesSummary(range, cells.cellSize), regions: monthlyRegions(range, cells.cellSize, isIndia),
          flowFor: (n) => { let f = flows.get(n); if (!f) { f = buildFlow(range, cells.cellSize, n, 11); flows.set(n, f); } return f; },
        });
      }
      if (token !== speciesToken) return;
      syncFollowed();
      if (fly && species) {
        const c = species.summary.centres[monthOf(store.get().t) - 1];
        if (c) globe.flyTo({ lng: c.lng, lat: c.lat, altitudeKm: SPECIES_ALT_KM });
      }
      render();
    } catch (err) {
      if (token !== speciesToken) return;
      console.error('Species failed to load', key, err);
      followed = unfollow(followed, key);
      speciesFailed = key;
      syncFollowed();
      render();
    }
  }

  // ---------- place ----------
  let cell: CellDetail | null = null;
  let cellStatus: 'loading' | 'ready' | 'none' | 'error' = 'none';
  let placeToken = 0;
  function pickPlace(lng: number, lat: number, named: { name: string; detail: string } | null = null, fly = true, toMap = false) {
    const id = cellIdAt(lng, lat, cells.cellSize);
    const cellId = cellSet.has(id) ? id : null;
    const place: Place = { lng, lat, cellId, name: named?.name ?? null, detail: named?.detail ?? null };
    if (fly) store.set({ follow: false });
    const token = ++placeToken;
    cell = null;
    cellStatus = cellId ? 'loading' : 'none';
    filterChoice = null;
    shown = PAGE;
    store.set({ place, panel: 'place' });
    globe.setPlace({ lng, lat, label: named?.name ?? `${fmtLat(lat)} ${fmtLng(lng)}`, cellId });
    if (toMap) globe.flyTo({ lng, lat, altitudeKm: Math.min(globe.camera().altitudeKm, TOWN_ALT_KM) });
    else if (fly) globe.flyTo({ lng, lat, altitudeKm: Math.min(globe.camera().altitudeKm, PLACE_ALT_KM) });
    if (!named) reversePlace(lng, lat).then((n) => {
      if (!n || token !== placeToken) return;
      store.set({ place: { ...store.get().place!, name: n.name, detail: n.detail } });
      globe.setPlace({ lng, lat, label: n.name, cellId });
    });
    if (cellId) loadCell(cellId).then((c) => { if (token === placeToken) { cell = c; cellStatus = 'ready'; render(); } })
      .catch((err) => { console.error('Cell failed to load', cellId, err); if (token === placeToken) { cellStatus = 'error'; render(); } });
  }

  // ---------- place list state: which filter, how many rows ----------
  const PAGE = 12;
  let filterChoice: PlaceFilter | null = null;
  let shown = PAGE;
  /** the visitor's choice, else "on the move" when anything is moving this month, else all */
  const placeFilter = (): PlaceFilter => {
    if (filterChoice) return filterChoice;
    const s = cell ? placeSummary(cell, monthOf(store.get().t)) : null;
    return s && filterRows(s, 'moving').length ? 'moving' : 'all';
  };
  const copyText = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => say('Citation copied.'), () => say(text));
  };

  // ---------- render ----------
  const tabLabel = (s: AtlasState) => ({
    place: s.place ? (s.place.name ?? 'This place') : null,
    species: species && species.entry.k === s.species ? (species.profile?.name || species.entry.name || species.entry.sci) : s.species ? 'Species' : null,
  });
  function render() {
    const s = store.get();
    const m = monthOf(s.t) - 1;
    where.textContent = `${s.place ? (s.place.name ?? `${fmtLat(s.place.lat)} ${fmtLng(s.place.lng)}`) : 'The whole planet'} · ${MONTH_LONG[m]}`;
    follow.setAttribute('aria-pressed', String(s.follow));
    follow.hidden = !s.species; // nothing to follow until a species is picked
    const open = s.panel !== null && (s.panel === 'place' ? s.place !== null : s.species !== null);
    document.body.classList.toggle('panel-open', open);
    globe.setInset(open && wide() ? PANEL_W : 0, open && !wide() ? window.innerHeight * 0.46 : 0);
    if (!open) { panel.close(); return; }
    if (s.panel === 'place' && s.place) {
      panel.show('place', tabLabel(s), placeView({
        place: s.place, month: m, status: cellStatus, summary: cell ? placeSummary(cell, (m + 1) as 1) : null,
        coverage: s.place.cellId ? coverage.get(s.place.cellId)?.[m] ?? null : null,
        env: globe.sample(s.place.lng, s.place.lat), species: byKey, thumbOf, filter: placeFilter(), shown, cellSize: cells.cellSize, noListNote: noListNote(coverageInfo),
      }, {
        onFilter: (f) => { filterChoice = f; shown = PAGE; render(); },
        onMore: () => { shown += 24; render(); },
        onDownload: () => { if (cell) download(`wildlife-atlas_${cell.id}.csv`, placeCsv(cell, byKey)); },
        onCite: () => copyText(citation(meta, `Birds recorded in grid cell ${s.place!.cellId}${s.place!.name ? ` (${s.place!.name})` : ''}`, new Date())),
        onSpecies: (k) => void selectSpecies(k, false), onMonth: (mm) => timelineMonth(mm), onShowMap: () => pickPlace(s.place!.lng, s.place!.lat, s.place!.name ? { name: s.place!.name, detail: s.place!.detail ?? '' } : null, true, true) }));
    } else if (s.panel === 'species') {
      const entry = s.species ? byKey.get(s.species) : null;
      if (!entry) return;
      panel.show('species', tabLabel(s), species && species.entry.k === entry.k
        ? speciesView({ entry, profile: species.profile, summary: species.summary, month: m, meta, regions: species.regions, color: colorOf(entry.k) }, {
          onJourney: (lng, lat, mm) => {
            store.set({ follow: false });
            timelineMonth(mm);
            globe.flyTo({ lng, lat, altitudeKm: SPECIES_ALT_KM });
          },
          onDownload: () => download(`wildlife-atlas_${entry.sci.replace(/\s+/g, '-').toLowerCase()}.csv`, speciesCsv(species!.range, cells.cellSize, entry)),
          onCite: () => copyText(citation(meta, `Monthly recorded presence of ${entry.sci}`, new Date())),
          onMonth: (mm) => timelineMonth(mm),
        })
        : h('p', { class: 'na pad' }, speciesFailed === entry.k ? `${entry.name || entry.sci} could not load. Try again or pick another species.` : `Loading ${entry.name || entry.sci}…`));
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
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    const typing = t?.closest('input, textarea, [contenteditable]');
    if (!typing && (e.key === '[' || e.key === ']')) { stepMonth(e.key === '[' ? -1 : 1); return; }
    if (e.key !== 'Escape' || e.defaultPrevented || t?.closest('.search, .legend')) return;
    store.set({ panel: null });
  });

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
      const lead = species.flowFor(Math.round(PARTICLES / Math.max(1, followed.length) * (followed.length > 1 ? 1.3 : 1)));
      if (scratch.buf.length !== lead.count * 3) scratch.buf = new Float32Array(lead.count * 3);
      const target = flockCenter(lead, t, scratch.buf);
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
    p.set('at', `${cam.lng.toFixed(3)},${cam.lat.toFixed(3)},${cam.altitudeKm < 100 ? cam.altitudeKm.toFixed(1) : Math.round(cam.altitudeKm)}`);
    if (!realColour) p.set('real', '0');
    history.replaceState(null, '', `atlas.html?${p.toString()}`);
  }, URL_SYNC_MS);

  // ---------- start ----------
  const [lng, lat, alt] = (q.get('at') ?? '').split(',').map(Number);
  const portrait = window.innerWidth < window.innerHeight * 0.8;
  if ([lng, lat, alt].every(Number.isFinite)) globe.flyTo({ lng: lng!, lat: lat!, altitudeKm: alt! }, 0);
  else globe.flyTo({ lng: 80, lat: 20, altitudeKm: portrait ? 40000 : 19000 }, 0);
  const requested = q.get('sp');
  // no species until one is picked or a link names it (?sp=): the atlas opens on the planet, not on one bird
  if (requested && byKey.has(requested)) void selectSpecies(requested, false, wide());
  const [pl, pa] = (q.get('place') ?? '').split(',').map(Number);
  if (Number.isFinite(pl) && Number.isFinite(pa) && Math.abs(pa!) <= 90) pickPlace(pl!, pa!, null, false);
  // old street-map links (?map=lng,lat,zoom) open at the same place on the one engine
  const [ml, mt, mz] = (q.get('map') ?? '').split(',').map(Number);
  if ([ml, mt, mz].every(Number.isFinite) && Math.abs(mt!) <= 85) globe.flyTo({ lng: ml!, lat: mt!, altitudeKm: altitudeForZoom(mz!) }, 0);
  // arriving from the story's "Species near you": the visitor already asked for their location
  if (q.get('locate') === '1') locateBtn.click();
  render();
}
