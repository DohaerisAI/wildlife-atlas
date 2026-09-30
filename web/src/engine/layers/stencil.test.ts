import { EqualStencilFunc, NotEqualStencilFunc, ReplaceStencilOp, ShaderMaterial, Texture, Vector2, Vector3, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { onTileLand, outsideTileLand, TILE_LAND_STENCIL, writesTileLand } from './stencil';
import { tileMaterial, sharedUniforms } from '../tiles/tile-shader';

describe('tile land stencil', () => {
  it('every land tile marks the pixels it draws', () => {
    const m = tileMaterial(sharedUniforms(), { land: new Texture(), ndvi: null, rgb: null }, new Vector3(1, 0, 0), new Vector4(), new Vector2());
    expect(m.stencilWrite).toBe(true);
    expect(m.stencilRef).toBe(TILE_LAND_STENCIL);
    expect(m.stencilZPass).toBe(ReplaceStencilOp);
  });

  it('sea effects draw off tile land and land glows only on it, and both switch off again', () => {
    const sea = new ShaderMaterial(); const land = new ShaderMaterial();
    outsideTileLand(sea, true); onTileLand(land, true);
    expect(sea.stencilWrite && sea.stencilFunc === NotEqualStencilFunc).toBe(true);
    expect(land.stencilWrite && land.stencilFunc === EqualStencilFunc).toBe(true);
    outsideTileLand(sea, false);
    expect(sea.stencilWrite).toBe(false); // pages without tiles keep their own coarse sea test
    const w = new ShaderMaterial(); writesTileLand(w);
    expect(w.stencilRef).toBe(TILE_LAND_STENCIL);
  });
});
