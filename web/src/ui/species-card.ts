import { formatRange, weightComparison, type SpeciesProfile } from '../species/profile';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const STATUS_TONE: Record<string, string> = { LC: 'good', NT: 'warn', VU: 'warn', EN: 'bad', CR: 'bad', EW: 'bad', EX: 'bad', DD: 'muted' };

/** Photo, name, size, status and a short description. Every photo shows its creator and licence. */
export function speciesCard(p: SpeciesProfile): HTMLElement {
  const card = el('article', 'species-card');
  card.setAttribute('aria-label', `About the ${p.name}`);

  if (p.images.length) {
    const fig = el('figure', 'sc-photo');
    // Never crop an animal: the photo is shown whole (contain) over a blurred copy of itself.
    const frame = el('div', 'sc-frame');
    const bg = el('img', 'sc-bg');
    bg.alt = ''; bg.setAttribute('aria-hidden', 'true');
    const img = el('img', 'sc-img');
    img.decoding = 'async';
    img.addEventListener('load', () => {
      const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
      frame.style.aspectRatio = String(Math.min(16 / 10, Math.max(4 / 5, ratio)));
    });
    frame.append(bg, img);
    const credit = el('figcaption', 'sc-credit');
    const show = (i: number) => {
      const im = p.images[i]!;
      img.src = im.url; bg.src = im.url;
      img.alt = `${p.name}${im.caption ? `, ${im.caption.toLowerCase()}` : ''}`;
      credit.replaceChildren(`${im.caption ? `${im.caption} · ` : ''}Photo: ${im.artist} · `, Object.assign(el('a', '', im.license), { href: im.page, target: '_blank', rel: 'noopener' }));
      tabs.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
    };
    const tabs = el('div', 'sc-tabs');
    if (p.images.length > 1) {
      p.images.forEach((im, i) => {
        const b = el('button', 'sc-tab', im.caption || `Photo ${i + 1}`);
        b.type = 'button';
        b.addEventListener('click', () => show(i));
        tabs.append(b);
      });
    }
    fig.append(frame, tabs, credit);
    card.append(fig);
    show(0);
  }

  const head = el('div', 'sc-head');
  head.append(el('h3', 'sc-name', p.name), el('p', 'sc-sci', p.scientific));
  card.append(head);

  const facts = el('dl', 'sc-facts');
  const add = (k: string, v: string, tone = '') => { const pair = el('div', 'sc-fact'); pair.append(el('dt', '', k), el('dd', tone ? `tone-${tone}` : '', v)); facts.append(pair); };
  if (p.facts.wingspan) add('Wingspan', formatRange(p.facts.wingspan));
  if (p.facts.length) add('Length', formatRange(p.facts.length));
  if (p.facts.mass) add('Weight', formatRange(p.facts.mass));
  if (p.facts.status) add('Status', p.facts.status.label, STATUS_TONE[p.facts.status.code] ?? '');
  if (facts.childElementCount) card.append(facts);

  const scale = weightComparison(p.facts.mass);
  if (scale) card.append(el('p', 'sc-scale', `${scale}.`));
  if (p.extract) card.append(el('p', 'sc-extract', p.extract.split(/(?<=\.)\s/).slice(0, 3).join(' ')));

  const src = el('p', 'sc-sources');
  src.append('Sources: ');
  p.sources.forEach((s, i) => { if (i) src.append(' · '); src.append(Object.assign(el('a', '', s.label), { href: s.url, target: '_blank', rel: 'noopener' })); });
  src.append(` · ${p.licence_note}`);
  card.append(src);
  return card;
}

/** A side drawer holding one species card; opened from the story HUD at any moment. */
export function speciesDrawer(p: SpeciesProfile): { open(): void; close(): void; element: HTMLElement } {
  const drawer = el('div', 'sc-drawer');
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', `About the ${p.name}`);
  drawer.hidden = true;
  const close = el('button', 'btn sc-close', 'Close');
  close.type = 'button';
  drawer.append(close, speciesCard(p));
  let opener: HTMLElement | null = null;
  const api = {
    element: drawer,
    open() { opener = document.activeElement as HTMLElement; drawer.hidden = false; requestAnimationFrame(() => drawer.classList.add('is-open')); close.focus(); },
    close() { drawer.classList.remove('is-open'); window.setTimeout(() => { drawer.hidden = true; }, 360); opener?.focus(); },
  };
  close.addEventListener('click', api.close);
  drawer.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.close(); });
  return api;
}
