import { describe, expect, it } from 'vitest';
import { envCaption, MATERIAL_CHANNELS } from './materials';

describe('Living Earth caption', () => {
  it('names the dataset behind every material on screen', () => {
    const text = envCaption({ water: 1, snow: 0.6, wind: 0.8 });
    expect(text).toMatch(/JRC/);
    expect(text).toMatch(/MODIS/);
    expect(text).toMatch(/ERA5/);
  });

  it('leaves out materials that are switched off', () => {
    const text = envCaption({ water: 0, snow: 0, wind: 1 });
    expect(text).toMatch(/ERA5/);
    expect(text).not.toMatch(/JRC|MODIS/);
    expect(envCaption({ water: 0, snow: 0, wind: 0 })).toBe('');
  });

  it('covers the three first materials', () => {
    expect([...MATERIAL_CHANNELS]).toEqual(['water', 'snow', 'wind']);
  });
});
