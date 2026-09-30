import { AlwaysStencilFunc, EqualStencilFunc, KeepStencilOp, NotEqualStencilFunc, ReplaceStencilOp, type Material } from 'three';

/**
 * Tile land in the stencil buffer. Land tiles mark every pixel they draw (ocean pixels are discarded), so the coarse
 * whole-globe layers can follow the tiles' 300 m coastline instead of their own 10-40 km cells:
 * - sea effects (shelf glow, blooms) draw only where no tile land was drawn (`outsideTileLand`);
 * - land-only glows (JRC surface water) draw only on tile land (`onTileLand`).
 * Needs a renderer created with `stencil: true` (core/stage.ts). Pages without tiles never call these.
 */
export const TILE_LAND_STENCIL = 1;

/** Tile patches draw at render order 0.5..2 (tiles/tile-layer.ts); masked layers must draw after them. */
export const AFTER_TILES_ORDER = 2.5;

export function writesTileLand(m: Material): void {
  Object.assign(m, {
    stencilWrite: true, stencilRef: TILE_LAND_STENCIL, stencilFunc: AlwaysStencilFunc,
    stencilZPass: ReplaceStencilOp, stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp,
  });
}

function stencilTest(m: Material, on: boolean, func: typeof EqualStencilFunc | typeof NotEqualStencilFunc): void {
  Object.assign(m, {
    stencilWrite: on, stencilRef: TILE_LAND_STENCIL, stencilFunc: func,
    stencilZPass: KeepStencilOp, stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp,
  });
  m.needsUpdate = true;
}

export const outsideTileLand = (m: Material, on: boolean): void => stencilTest(m, on, NotEqualStencilFunc);
export const onTileLand = (m: Material, on: boolean): void => stencilTest(m, on, EqualStencilFunc);
