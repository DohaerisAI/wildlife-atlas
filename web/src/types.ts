export type Presence = 'resident' | 'seasonal' | 'passage' | 'uncertain';
export type Coverage = 'well' | 'some' | 'limited';

export interface Meta {
  source: { name: string; url: string; years: string; demo: boolean; note: string };
  resolution: 'month';
  evidence: string;
  measure: string;
  generated: string;
}

export interface CellIndexEntry {
  id: string;
  total: number[];
  richness: number[];
  coverage: Coverage[];
}

export interface CellsIndex {
  cellSize: number;
  cells: CellIndexEntry[];
}

export interface CellSpecies {
  k: string;
  c: number[];
  p: Presence;
  m: number[];
}

export interface CellDetail {
  id: string;
  total: number[];
  species: CellSpecies[];
}

export interface SpeciesIndexEntry {
  k: string;
  sci: string;
  name: string;
  family: string;
  cells: number;
}

export interface SpeciesRange {
  k: string;
  cells: Record<string, { r: number[]; p: Presence }>;
}

/** Month is 1..12 throughout the client. */
export type Month = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
