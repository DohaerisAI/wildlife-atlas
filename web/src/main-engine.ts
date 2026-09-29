import './design/tokens.css';
import './experiences/engine.css';
import { startEngine } from './experiences/engine-page';

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in engine.html`);
  return el;
};

startEngine({ stage: $('stage'), labels: $('labels'), hud: $('hud'), controls: $('controls'), note: $('note') }).catch((err) => {
  console.error('Engine failed to start', err);
  $('note').textContent = 'The engine could not start. It needs WebGL2 and the Living Earth pack.';
});
