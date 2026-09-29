import { describe, expect, it } from 'vitest';
import { placeNameFrom } from './geocode';
import { parseProfileIndex, thumbFor } from './profile-index';

describe('place names', () => {
  it('prefers the town and adds state and country', () => {
    expect(placeNameFrom({ name: 'Wokha', town: 'Wokha', state: 'Nagaland', country: 'India' })).toEqual({ name: 'Wokha', detail: 'Nagaland, India' });
    expect(placeNameFrom({ state: 'Rajasthan', country: 'India' })).toEqual({ name: 'Rajasthan', detail: 'India' });
    expect(placeNameFrom({})).toBeNull();
  });
});

describe('profile index', () => {
  it('reads both the list and the object format', () => {
    expect(parseProfileIndex(['falco-amurensis']).has('falco-amurensis')).toBe(true);
    const v2 = parseProfileIndex({ 'falco-amurensis': { name: 'Amur Falcon', sci: 'Falco amurensis', thumb: 'https://x/t.jpg' } });
    expect(thumbFor(v2, 'Falco amurensis')).toBe('https://x/t.jpg');
    expect(thumbFor(v2, 'Pavo cristatus')).toBeNull();
    expect(parseProfileIndex(null).size).toBe(0);
  });
});
