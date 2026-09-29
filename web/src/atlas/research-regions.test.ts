import { describe, expect, it } from 'vitest';
import type { CellDetail, Meta, SpeciesRange } from '../types';
import { journeyRows, monthlyRegions, regionOf } from './regions';
import { citation, csvField, placeCsv, speciesCsv } from './research';

const on = (months: number[], v = 1) => Array.from({ length: 12 }, (_, i) => (months.includes(i + 1) ? v : 0));

describe('regions', () => {
  it('names places in words, India from the atlas grid', () => {
    expect(regionOf(80, 22, true)).toBe('India');
    expect(regionOf(88, 30, false)).toBe('the Himalaya and Tibet');
    expect(regionOf(125, 45, false)).toBe('East Asia');
    expect(regionOf(28, -25, false)).toBe('southern Africa');
    expect(regionOf(-40, -80, false)).toBe('elsewhere');
  });

  it('turns a migrant\'s year into a few readable legs', () => {
    const range: SpeciesRange = {
      k: 'falcon',
      cells: {
        '48_120': { p: 'seasonal', r: on([5, 6, 7, 8]) },
        '25_93': { p: 'passage', r: on([10, 11], 2) },
        '-25_28': { p: 'seasonal', r: on([12, 1, 2, 3]) },
      },
    };
    const { months, india } = monthlyRegions(range, 1, (id) => id === '25_93');
    expect(months[6]!.region).toBe('East Asia');
    expect(india[9]).toBe(1);
    const rows = journeyRows(months);
    expect(rows.map((r) => [r.region, r.from, r.to])).toEqual([
      ['southern Africa', 11, 2], ['East Asia', 4, 7], ['India', 9, 10],
    ]);
  });
});

describe('research downloads', () => {
  it('escapes CSV fields and blocks spreadsheet formulas', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('=HYPERLINK(1)')).toBe("'=HYPERLINK(1)");
    expect(csvField(-3)).toBe('-3');
  });

  it('writes a place list with effort first and a species presence table', () => {
    const cell: CellDetail = { id: '26_94', total: on([1, 2], 10), species: [{ k: '1', p: 'resident', c: on([1, 2], 3), m: on([1, 2]) }] };
    const names = new Map([['1', { k: '1', sci: 'Pycnonotus cafer', name: 'Red-vented Bulbul', family: 'Pycnonotidae', cells: 5 }]]);
    const lines = placeCsv(cell, names).trim().split('\n');
    expect(lines[0]!.startsWith('gbif_taxon_key,scientific_name')).toBe(true);
    expect(lines[1]).toContain('ALL BIRD RECORDS,,,10,10');
    expect(lines[2]).toContain('Pycnonotus cafer,Red-vented Bulbul,resident,3,3');
    const sp = speciesCsv({ k: '1', cells: { '26_94': { p: 'resident', r: on([1], 0.5) } } }, 1, names.get('1')!).trim().split('\n');
    expect(sp[1]).toContain('26_94,26,94,1,resident,0.5');
  });

  it('cites the data source and version', () => {
    const meta = { source: { name: 'GBIF occurrence records', url: '', years: '2010–2026', demo: false, note: '' }, resolution: 'month', evidence: '', measure: '', generated: '2026-09-28T06:07:11+00:00' } as Meta;
    const c = citation(meta, 'Birds recorded at Satna', new Date(Date.UTC(2026, 8, 29)));
    expect(c).toContain('GBIF occurrence records, 2010–2026');
    expect(c).toContain('data generated 2026-09-28');
    expect(c).toContain('accessed 2026-09-29');
  });
});
