import './design/tokens.css';
import './story/story.css';
import { startStoryPage } from './experiences/story-page';

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el;
};

startStoryPage({ stage: $('stage'), story: $('story'), pins: $('pins'), month: $('hud-month'), progress: $('progress'), banner: $('demo-banner') })
  .catch((err) => {
    console.error('Story failed to start', err);
    $('story').innerHTML = '<p class="nojs">The story could not start. It needs WebGL and the atlas data (run <code>atlas demo</code> or <code>atlas build</code>).</p>';
  });
