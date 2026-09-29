import './design/tokens.css';
import './atlas/atlas.css';
import { startAtlas } from './atlas/app';

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in atlas.html`);
  return el;
};

startAtlas({ stage: $('stage'), pins: $('pins'), ui: $('ui'), banner: $('demo-banner'), env: $('env-note') }).catch((err) => {
  console.error('Atlas failed to start', err);
  $('ui').innerHTML = '<p class="nojs">The atlas could not start. It needs WebGL and the atlas data (run <code>atlas build</code>).</p>';
});
