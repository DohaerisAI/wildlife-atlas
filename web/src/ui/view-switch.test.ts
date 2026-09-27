import { describe, expect, it } from 'vitest';
import { viewUrl } from './view-switch';

describe('viewUrl', () => {
  it('routes scene views to index with view param', () => {
    expect(viewUrl('real', { month: 10, species: 'demo-falamu' })).toBe('./?view=real&m=10&sp=demo-falamu');
  });
  it('routes map with cell, camera and dive flag', () => {
    const url = viewUrl('map', { month: 3, species: null, cell: '25_93', at: { lng: 93.5, lat: 25.5, zoom: 5 }, dive: true });
    expect(url).toBe('map.html?m=3&cell=25_93&at=93.500%2C25.500%2C5.00&dive=1');
  });
});
