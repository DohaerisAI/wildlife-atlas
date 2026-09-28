import './design/tokens.css';
import './experiences/atlas/atlas.css';
import { loadCells, loadMeta, loadSpeciesIndex } from './data';
import { loadMask } from './engine/globe/mask';
import type { ViewKind } from './scene/view';

function root(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el;
}

function requestedView(): Exclude<ViewKind, 'map'> {
  return new URLSearchParams(location.search).get('view') === 'real' ? 'real' : 'holo';
}

async function boot() {
  const kind = requestedView();
  document.body.dataset.view = kind;
  try {
    const [meta, cells, species, { startShell }] = await Promise.all([loadMeta(), loadCells(), loadSpeciesIndex(), import('./scene/shell')]);
    root('demo-banner').hidden = !meta.source.demo;
    const stage = root('stage');
    if (kind === 'real') {
      (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = `${import.meta.env.BASE_URL}cesium/`;
      const { createRealView } = await import('./views/real/real-view');
      startShell(createRealView(stage), { meta, cells, species }, stage, root('hud'), root('view-switch'), { kind, particles: 2500 });
    } else {
      const [{ createGlobeView }, mask] = await Promise.all([import('./views/globe/globe-view'), loadMask(`${import.meta.env.BASE_URL}geo/land-mask.png`)]);
      startShell(createGlobeView({ stage, env: root('env-note') }, mask), { meta, cells, species }, stage, root('hud'), root('view-switch'), { kind, particles: 3500 });
    }
  } catch (err) {
    console.error('Wildlife Atlas scene failed to start', err);
    root('hud').textContent = 'The atlas could not start. Check that data exists (run `atlas demo`) and that WebGL is available.';
  }
}

void boot();
