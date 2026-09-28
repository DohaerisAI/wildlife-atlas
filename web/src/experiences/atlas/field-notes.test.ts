import { describe, expect, it } from 'vitest';
import type { CellDetail } from '../../types';
import { fieldNotes } from './field-notes';

const months = (on: number[]) => Array.from({ length: 12 }, (_, i) => (on.includes(i + 1) ? 1 : 0));
const counts = (n: number) => new Array<number>(12).fill(n);

const CELL: CellDetail = {
  id: '26_94',
  total: counts(100),
  species: [
    { k: 'bulbul', p: 'resident', c: counts(30), m: months([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) },
    { k: 'falcon', p: 'passage', c: counts(20), m: months([10, 11]) },
    { k: 'wagtail', p: 'seasonal', c: counts(10), m: months([10, 11, 12, 1, 2, 3]) },
    { k: 'cuckoo', p: 'seasonal', c: counts(5), m: months([6, 7, 8, 9, 10]) },
    { k: 'goose', p: 'seasonal', c: counts(4), m: months([11, 12, 1]) },
  ],
};

describe('field notes', () => {
  it('says who is arriving, leaving, passing and resident this month', () => {
    const notes = fieldNotes(CELL, 10);
    const status = Object.fromEntries(notes.rows.map((r) => [r.key, r.status]));
    expect(status).toEqual({ bulbul: 'resident', falcon: 'passing', wagtail: 'arriving', cuckoo: 'leaving' });
  });

  it('wraps the year when judging arrivals and departures', () => {
    const status = Object.fromEntries(fieldNotes(CELL, 1).rows.map((r) => [r.key, r.status]));
    expect(status.goose).toBe('leaving');
    expect(status.wagtail).toBe('visiting');
  });

  it('puts movers before residents, then orders by share, and caps the list', () => {
    expect(fieldNotes(CELL, 10).rows.map((r) => r.key)).toEqual(['wagtail', 'falcon', 'cuckoo', 'bulbul']);
    const notes = fieldNotes(CELL, 10, 2);
    expect(notes.rows.map((r) => r.key)).toEqual(['wagtail', 'falcon']);
    expect(notes.total).toBe(4);
  });
});
