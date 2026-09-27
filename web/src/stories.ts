import type { Month } from './types';

export interface Story {
  id: string;
  scientific: string;
  title: string;
  center: [number, number];
  zoom: number;
  steps: StoryStep[];
}

export interface StoryStep {
  month: Month;
  text: string;
  /** Optional camera move for this step: [lng, lat, map zoom]. */
  camera?: [number, number, number];
}

export const STORIES: Story[] = [
  {
    id: 'amur-falcon',
    scientific: 'Falco amurensis',
    title: 'Amur Falcon: Siberia to South Africa',
    center: [93.5, 25.5],
    zoom: 4.6,
    steps: [
      { month: 7, text: 'Amur Falcons breed in summer across the Amur region of south-eastern Siberia and north-eastern China.', camera: [122, 47, 3.6] },
      { month: 9, text: 'In September they head south and west across China.', camera: [108, 35, 3.2] },
      { month: 10, text: 'In October, huge numbers gather to roost in Nagaland and the nearby hills of Northeast India.', camera: [94, 25.8, 5.2] },
      { month: 11, text: 'They cross peninsular India, then set out over the Arabian Sea: thousands of kilometres of open water.', camera: [70, 12, 2.9] },
      { month: 1, text: 'They spend the southern summer in the grasslands of southern Africa.', camera: [27, -23, 3.6] },
      { month: 4, text: 'In spring they head north through East Africa, then back towards Asia to breed.', camera: [40, 5, 3.0] },
    ],
  },
  {
    id: 'bar-headed-goose',
    scientific: 'Anser indicus',
    title: 'Bar-headed Goose: over the Himalaya',
    center: [85, 30],
    zoom: 3.6,
    steps: [
      { month: 7, text: 'In summer, Bar-headed Geese breed on high lakes of the Tibetan plateau, Ladakh and Mongolia.', camera: [90, 37, 3.8] },
      { month: 10, text: 'In autumn they cross the Himalaya, one of the highest migrations of any bird.', camera: [85, 29, 4.6] },
      { month: 1, text: 'Through winter they feed on wetlands and fields across the northern and central Indian plains.', camera: [80, 25, 4.0] },
      { month: 4, text: 'By April they fly back over the mountains to breed.', camera: [88, 33, 3.8] },
    ],
  },
  {
    id: 'pied-cuckoo',
    scientific: 'Clamator jacobinus',
    title: 'Pied Cuckoo: messenger of the monsoon',
    center: [60, 10],
    zoom: 2.8,
    steps: [
      { month: 3, text: 'Through the northern winter, many Pied Cuckoos live in East Africa.', camera: [37, 0, 3.4] },
      { month: 6, text: 'They arrive in India with the monsoon winds. Folklore links their call to the coming rains.', camera: [60, 12, 2.8] },
      { month: 8, text: 'Through the rains they breed across northern and central India.', camera: [79, 24, 4.0] },
      { month: 11, text: 'As the monsoon retreats, they cross back to Africa.', camera: [55, 8, 2.8] },
    ],
  },
  {
    id: 'golden-oriole',
    scientific: 'Oriolus kundoo',
    title: 'Indian Golden Oriole: north for summer',
    center: [72, 28],
    zoom: 3.4,
    steps: [
      { month: 6, text: 'In summer, orioles breed across northern India and into Central Asia.', camera: [70, 33, 3.6] },
      { month: 8, text: 'Through the monsoon they are widespread in the north.', camera: [78, 26, 3.8] },
      { month: 11, text: 'In winter many move to southern India, so the pattern flips.', camera: [78, 15, 4.0] },
      { month: 2, text: 'By late winter the south holds most records, before they return north.', camera: [77, 18, 3.8] },
    ],
  },
];

export const ENTRY_POINTS = [
  { label: 'Northeast India', center: [93.5, 25.8] as [number, number], zoom: 5.2 },
  { label: 'Northern wetlands', center: [77.5, 27.2] as [number, number], zoom: 5.2 },
  { label: 'Western Ghats', center: [76.4, 11] as [number, number], zoom: 5.2 },
  { label: 'Rann of Kutch', center: [70.5, 23.6] as [number, number], zoom: 5.4 },
];
