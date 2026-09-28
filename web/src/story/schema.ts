/**
 * Stories are data. A chapter is a keyframe: where the camera is, which month it is, and a set of
 * named channels (0..1) that experiences map onto layers (flock opacity, track progress, ...).
 * Scrolling moves continuously from one chapter's keyframe to the next.
 */
export interface Source { readonly label: string; readonly url: string }

export interface Counter {
  readonly channel: string;
  /** channel values over which the counter runs */
  readonly domain: readonly [number, number];
  /** displayed values at the two ends of the domain */
  readonly range: readonly [number, number];
  readonly unit: string;
}

export interface Pin { readonly id: string; readonly text: string; readonly lng: number; readonly lat: number; readonly kind?: 'place' | 'animal' }

export interface Chapter {
  readonly id: string;
  readonly kicker: string;
  readonly title: string;
  readonly body: readonly string[];
  readonly camera: { readonly lng: number; readonly lat: number; readonly altKm: number; readonly frameX: number };
  /** fractional month, 0 = 1 Jan, 0.5 = mid-January */
  readonly month: number;
  readonly channels: Readonly<Record<string, number>>;
  readonly counters?: readonly Counter[];
  readonly pins?: readonly Pin[];
  readonly note?: string;
  readonly sources?: readonly Source[];
}

export interface Story {
  readonly id: string;
  readonly title: string;
  readonly species: string;
  readonly chapters: readonly Chapter[];
}

export class StoryError extends Error {}

export function validateStory(story: Story): Story {
  const fail = (msg: string) => { throw new StoryError(`Story ${story.id}: ${msg}`); };
  if (story.chapters.length < 2) fail('needs at least two chapters');
  const ids = new Set<string>();
  const channelNames = new Set(Object.keys(story.chapters[0]!.channels));
  story.chapters.forEach((c, i) => {
    if (ids.has(c.id)) fail(`duplicate chapter id ${c.id}`);
    ids.add(c.id);
    if (!(c.month >= 0 && c.month < 12)) fail(`chapter ${c.id} month ${c.month} is outside 0..12`);
    if (Math.abs(c.camera.lat) > 90 || c.camera.altKm <= 0) fail(`chapter ${c.id} has an impossible camera`);
    const names = Object.keys(c.channels);
    if (names.length !== channelNames.size || names.some((n) => !channelNames.has(n))) fail(`chapter ${c.id} (#${i}) must set the same channels as the first chapter`);
    c.counters?.forEach((k) => { if (!channelNames.has(k.channel)) fail(`chapter ${c.id} counter uses unknown channel ${k.channel}`); });
  });
  return story;
}
