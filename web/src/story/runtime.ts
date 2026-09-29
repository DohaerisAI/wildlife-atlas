import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { counterValue } from './interpolate';
import type { Chapter, Story } from './schema';

gsap.registerPlugin(ScrollTrigger, SplitText);

export interface StoryRuntime {
  /** continuous story position: chapter i's keyframe is reached when its section reaches the top */
  position(): number;
  updateCounters(chapter: number, channels: Readonly<Record<string, number>>): void;
  /** chapters that asked for the species profile card */
  profileSlots(): HTMLElement[];
  dispose(): void;
}

const fmt = new Intl.NumberFormat('en-IN');

function chapterEl(c: Chapter, i: number, last: boolean): HTMLElement {
  const sec = document.createElement('section');
  sec.className = `chapter${i === 0 ? ' chapter-open' : ''}`;
  sec.id = `ch-${c.id}`;
  sec.setAttribute('aria-labelledby', `ch-${c.id}-title`);
  const card = document.createElement('div');
  card.className = 'card';
  const kicker = Object.assign(document.createElement('p'), { className: 'kicker', textContent: c.kicker });
  const title = Object.assign(document.createElement(i === 0 ? 'h1' : 'h2'), { className: 'title', id: `ch-${c.id}-title`, textContent: c.title });
  card.append(kicker, title);
  c.body.forEach((t) => card.append(Object.assign(document.createElement('p'), { className: 'body', textContent: t })));
  if (c.counters?.length) {
    const row = Object.assign(document.createElement('div'), { className: 'counters' });
    c.counters.forEach((k, j) => {
      const box = Object.assign(document.createElement('div'), { className: 'counter' });
      box.append(Object.assign(document.createElement('span'), { className: 'n', textContent: fmt.format(k.range[0]) }), Object.assign(document.createElement('span'), { className: 'u', textContent: k.unit }));
      box.dataset.counter = String(j);
      row.append(box);
    });
    card.append(row);
  }
  if (c.profile) card.append(Object.assign(document.createElement('div'), { className: 'profile-slot' }));
  if (c.note) card.append(Object.assign(document.createElement('p'), { className: 'note', textContent: c.note }));
  if (c.sources?.length) {
    const src = Object.assign(document.createElement('p'), { className: 'sources' });
    src.append('Sources: ');
    c.sources.forEach((s, j) => {
      if (j) src.append(' · ');
      src.append(Object.assign(document.createElement('a'), { href: s.url, textContent: s.label, target: '_blank', rel: 'noopener' }));
    });
    card.append(src);
  }
  if (last) {
    const cta = Object.assign(document.createElement('div'), { className: 'cta' });
    cta.append(
      Object.assign(document.createElement('a'), { className: 'btn hot', href: 'atlas.html', textContent: 'Open the atlas' }),
      Object.assign(document.createElement('a'), { className: 'btn', href: 'atlas.html?locate=1', textContent: 'Species near you' }),
    );
    card.append(cta);
  }
  sec.append(card);
  return sec;
}

export function mountStory(root: HTMLElement, story: Story, reduced: boolean): StoryRuntime {
  const list = document.createElement('div');
  list.className = 'chapters';
  const sections = story.chapters.map((c, i) => chapterEl(c, i, i === story.chapters.length - 1));
  list.append(...sections);
  root.append(list);

  const proxy = { s: 0 };
  const smooth = reduced ? (v: number) => { proxy.s = v; } : gsap.quickTo(proxy, 's', { duration: 0.9, ease: 'power3.out' });
  const n = story.chapters.length;
  const trigger = ScrollTrigger.create({
    trigger: list, start: 'top top', end: 'bottom bottom',
    onUpdate: (self) => {
      const h = sections[0]!.offsetHeight || window.innerHeight;
      smooth(Math.max(0, Math.min(n - 1, (self.scroll() - self.start) / h)));
    },
  });

  const splits: SplitText[] = [];
  const reveals: ScrollTrigger[] = [];
  if (!reduced) {
    sections.forEach((sec) => {
      const title = sec.querySelector<HTMLElement>('.title')!;
      const split = SplitText.create(title, { type: 'lines', mask: 'lines', autoSplit: true });
      splits.push(split);
      const tl = gsap.timeline({ paused: true })
        .from(split.lines, { yPercent: 110, duration: 1.1, ease: 'expo.out', stagger: 0.08 })
        .from(sec.querySelectorAll('.kicker, .body, .counters, .note, .sources, .cta'), { autoAlpha: 0, y: 14, duration: 0.9, ease: 'power3.out', stagger: 0.06 }, 0.15);
      reveals.push(ScrollTrigger.create({ trigger: sec, start: 'top 75%', onEnter: () => tl.play(), onLeaveBack: () => tl.reverse() }));
    });
  }

  return {
    position: () => proxy.s,
    updateCounters(chapter, channels) {
      const c = story.chapters[chapter];
      if (!c?.counters) return;
      sections[chapter]!.querySelectorAll<HTMLElement>('.counter').forEach((box) => {
        const k = c.counters![Number(box.dataset.counter)]!;
        const v = counterValue(k, channels);
        const el = box.querySelector('.n')!;
        const text = fmt.format(Math.round(k.range[1] > 100 ? v / 10 : v) * (k.range[1] > 100 ? 10 : 1));
        if (el.textContent !== text) el.textContent = text;
      });
    },
    profileSlots: () => [...list.querySelectorAll<HTMLElement>('.profile-slot')],
    dispose() { trigger.kill(); reveals.forEach((r) => r.kill()); splits.forEach((s) => s.revert()); list.remove(); },
  };
}
