import { geoPath } from '../engine/layers/path';
import { validateStory, type Source, type Story } from '../story/schema';

/**
 * Illustrative route for Chiulon, drawn from published descriptions of the tagged falcons
 * (Manipur → across India → nonstop over the Arabian Sea → Somalia → southern Africa).
 * It is NOT a satellite track; the UI labels it as illustrative until real telemetry is loaded.
 */
export const CHIULON_ROUTE: readonly (readonly [number, number])[] = [
  [93.55, 24.99], // Tamenglong, Manipur
  [88.4, 23.4],
  [82.0, 21.3],
  [77.2, 18.9],
  [73.2, 16.4], // leaves India's west coast
  [66.0, 13.2],
  [58.5, 9.8],
  [50.8, 6.4], // reaches the Somali coast
  [44.0, 1.0],
  [38.5, -7.5],
  [33.0, -16.5],
  [28.5, -25.0], // southern Africa
];
export const CHIULON_PATH = geoPath(CHIULON_ROUTE);
const COAST = CHIULON_PATH.fractionAt(4);
const SOMALIA = CHIULON_PATH.fractionAt(7);
/** Manipur to the Somali coast without landing: across India, then the Arabian Sea. */
const NONSTOP_KM = Math.round((SOMALIA * CHIULON_PATH.km) / 50) * 50;

const S = {
  birdlife: { label: 'BirdLife DataZone · Amur Falcon', url: 'https://datazone.birdlife.org/species/factsheet/amur-falcon-falco-amurensis' },
  cms: { label: 'CMS Raptors MoU · satellite tracking of Amur Falcons', url: 'https://raptors.cms.int/sites/default/files/document/Inf.14_Satellite%20Tracking%20of%20Amur%20Falcon%20Falco%20Amurensis.pdf' },
  tribune: { label: 'The Tribune · tagged falcons cross the Arabian Sea', url: 'https://www.tribuneindia.com/news/nation/radio-tagged-falcons-fly-over-5-000-km-non-stop-across-arabian-sea-172638' },
  ci: { label: 'Conservation India · Amur Falcon campaign', url: 'https://www.conservationindia.org/campaigns/amur-massacre' },
  dragonfly: { label: 'Wikipedia · Globe skimmer migration', url: 'https://en.wikipedia.org/wiki/Pantala_flavescens' },
} satisfies Record<string, Source>;

const WIDE = 0.2; // globe shifted right to leave room for text on wide screens

export const CHIULON: Story = validateStory({
  id: 'chiulon',
  title: "Chiulon's crossing",
  species: 'Falco amurensis',
  chapters: [
    {
      id: 'open', kicker: 'Right now', title: 'The planet is on the move',
      body: ['Every glowing thread is a species travelling with the seasons, drawn from real sightings.', 'Scroll to follow one of them, a falcon smaller than a pigeon, on one of the longest journeys of any bird of prey.'],
      camera: { lng: 72, lat: 20, altKm: 15500, frameX: WIDE }, month: 10.5,
      channels: { others: 1, flock: 0.7, track: 0 },
    },
    {
      id: 'meet', kicker: 'Meet the traveller', title: 'The Amur Falcon',
      body: ['A small falcon that hunts insects on the wing: termites, locusts, dragonflies.', 'Males are dark slate grey with orange-red legs and eye-rings. Females are paler and barred below.'],
      camera: { lng: 121, lat: 46, altKm: 4200, frameX: WIDE }, month: 6.5,
      channels: { others: 0, flock: 0.8, track: 0 }, profile: true,
      sources: [{ label: 'Wikipedia · Amur falcon', url: 'https://en.wikipedia.org/wiki/Amur_falcon' }],
    },
    {
      id: 'amur', kicker: 'I · July', title: 'Summer in the Amur',
      body: ['Amur Falcons breed in the woodlands of south-eastern Siberia and north-eastern China, along the Amur river.', 'Each glow is a share of where they were seen this month, not a single bird.'],
      camera: { lng: 122, lat: 47, altKm: 7000, frameX: WIDE }, month: 6.5,
      channels: { others: 0, flock: 1, track: 0 }, sources: [S.birdlife],
    },
    {
      id: 'south', kicker: 'II · September', title: 'The long way south',
      body: ['In September they turn south across China. The full round trip runs to roughly 22,000 km.'],
      camera: { lng: 105, lat: 34, altKm: 8000, frameX: WIDE }, month: 8.5,
      channels: { others: 0, flock: 1, track: 0 }, sources: [S.cms],
    },
    {
      id: 'gathering', kicker: 'III · October', title: 'The gathering',
      body: ['In October they pour into Nagaland and the nearby hills. At Doyang reservoir, hundreds of thousands roost together.', 'Until 2012, tens of thousands were netted here every autumn. Then the villages that hunted them chose to protect them.'],
      camera: { lng: 94.2, lat: 26.2, altKm: 1900, frameX: WIDE }, month: 9.5,
      channels: { others: 0, flock: 1, track: 0 }, sources: [S.ci],
      pins: [{ id: 'doyang', text: 'Doyang reservoir', lng: 94.2, lat: 26.2 }],
    },
    {
      id: 'chiulon', kicker: 'IV · November', title: 'One falcon',
      body: ['In Tamenglong, Manipur, the Wildlife Institute of India fitted a few falcons with satellite tags and named them after local villages and rivers.', 'One of them was called Chiulon.'],
      camera: { lng: 91, lat: 24, altKm: 2400, frameX: WIDE }, month: 10.1,
      channels: { others: 0, flock: 0.25, track: 0.02 }, sources: [S.tribune],
      pins: [{ id: 'tamenglong', text: 'Tamenglong', lng: 93.55, lat: 24.99 }],
      note: 'Route shown is illustrative, drawn from published reports. Chiulon\'s satellite track is not loaded yet.',
    },
    {
      id: 'sea', kicker: 'V · November', title: 'The open sea',
      body: ['Chiulon flew west across the whole of India and out over the Arabian Sea without stopping. From Manipur to Somalia, it never landed.', 'Researchers think the falcons ride the winter monsoon winds, and may feed on migrating dragonflies making the same crossing.'],
      camera: { lng: 63, lat: 11, altKm: 5600, frameX: WIDE }, month: 10.5,
      channels: { others: 0, flock: 0.12, track: COAST },
      counters: [
        { channel: 'track', domain: [0, SOMALIA], range: [0, NONSTOP_KM], unit: 'km without landing' },
        { channel: 'track', domain: [0, SOMALIA], range: [1, 5], unit: 'days in the air' },
      ],
      sources: [S.tribune, S.dragonfly],
      note: 'More than the distance from Mumbai to Nairobi, on wings about 65 cm across.',
    },
    {
      id: 'landfall', kicker: 'VI · Late November', title: 'Landfall',
      body: ['About five days later, Chiulon reached the coast of Somalia, then carried on south through East Africa.'],
      camera: { lng: 45, lat: 2, altKm: 6500, frameX: WIDE }, month: 10.9,
      channels: { others: 0, flock: 0.3, track: SOMALIA }, sources: [S.tribune],
    },
    {
      id: 'africa', kicker: 'VII · January', title: 'Summer, again',
      body: ['The falcons spend the southern summer on the grasslands of southern Africa. They have chased summer from one hemisphere to the other.'],
      camera: { lng: 27, lat: -20, altKm: 7500, frameX: WIDE }, month: 0.5,
      channels: { others: 0, flock: 1, track: 1 }, sources: [S.birdlife],
    },
    {
      id: 'return', kicker: 'VIII · April', title: 'And back',
      body: ['In spring the journey runs in reverse, north through East Africa and back to the Amur to breed.'],
      camera: { lng: 60, lat: 18, altKm: 14000, frameX: WIDE }, month: 3.5,
      channels: { others: 0, flock: 1, track: 1 },
    },
    {
      id: 'atlas', kicker: 'Every species has a year like this', title: 'Explore the atlas',
      body: ['Follow any species through its year, or see who passes over your own city this month.'],
      camera: { lng: 75, lat: 20, altKm: 17000, frameX: 0 }, month: 3.5,
      channels: { others: 1, flock: 0.7, track: 0 },
    },
  ],
});
