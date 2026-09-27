import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import './scene.css';
import { startApp } from './app';
import { loadCells, loadMeta, loadSpeciesIndex } from './data';

function root(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el;
}

async function boot() {
  const banner = root('demo-banner');
  try {
    const [meta, cells, species] = await Promise.all([loadMeta(), loadCells(), loadSpeciesIndex()]);
    banner.hidden = !meta.source.demo;
    startApp({ meta, cells, species }, {
      map: root('map'), panel: root('panel'), timeline: root('timeline'), search: root('search'),
      legend: root('legend'), story: root('story'), status: root('status'), viewSwitch: root('view-switch'),
    });
  } catch (err) {
    console.error('Wildlife Atlas failed to start', err);
    root('panel').textContent = 'The atlas data could not be loaded. Run the pipeline (`atlas demo` or `atlas build`) and reload.';
  }
}

void boot();
