import { describe, expect, it } from 'vitest';
import { formatRange, profileSlug, weightComparison } from './profile';

describe('species profile helpers', () => {
  it('slugs scientific names like the pipeline', () => expect(profileSlug('Falco amurensis')).toBe('falco-amurensis'));

  it('formats ranges with units', () => {
    expect(formatRange({ min: 63, max: 76, unit: 'cm' })).toBe('63–76 cm');
    expect(formatRange({ min: 125, max: 125, unit: 'g' })).toBe('125 g');
    expect(formatRange({ min: 2000, max: 3500, unit: 'g' })).toBe('2 kg – 3.5 kg');
  });

  it('compares weights to everyday things', () => {
    expect(weightComparison({ min: 125, max: 150, unit: 'g' })).toBe('Lighter than a cricket ball');
    expect(weightComparison({ min: 20000000, max: 30000000, unit: 'g' })).toBe('Heavier than an elephant');
    expect(weightComparison(undefined)).toBe('');
  });
});
