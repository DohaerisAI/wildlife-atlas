"""Big-block requests for the tile pyramid: one computePixels call covers many 256 px tiles, cut up on the runner.

A call per tile spends most of its time on per-request overhead and burns the project's Earth Engine concurrency
(the noncommercial project runs in Restricted Mode). Tiles are grouped into square blocks as big as the response
budget allows (computePixels answers at most ~48 MB), each block is requested as the bounding rectangle of its land
tiles, and a block that times out or runs out of memory is split into quarters and tried again, down to one tile.
Everything here is pure; the Earth Engine side lives in `tiles_ee`.
"""

from collections import defaultdict

import numpy as np

from . import tile_math as tm

RESPONSE_BUDGET = 32 * 1024 * 1024  # bytes per call, under computePixels' ~48 MB limit with room for overhead
MAX_BLOCK_PX = 2048

Rect = tuple[int, int, int, int]  # x, y, width, height in tile units at one level


def block_side(bands: int, tile_px: int = tm.TILE_PX, bytes_per: int = 4, budget: int = RESPONSE_BUDGET,
               max_px: int = MAX_BLOCK_PX) -> int:
    """Tiles per block side: the largest power of two whose float block of `bands` fits the budget (at least 1)."""
    side = 1
    while side * 2 * tile_px <= max_px and (side * 2 * tile_px) ** 2 * bands * bytes_per <= budget:
        side *= 2
    return side


def plan_blocks(tiles: list[tm.Tile], side: int, floor_level: int = 0) -> list[list[tm.Tile]]:
    """Group same-level tiles into blocks of up to side x side (by their ancestor), never across `floor_level`."""
    if not tiles:
        return []
    level = tiles[0][0]
    if any(t[0] != level for t in tiles):
        raise ValueError("tiles must share one level")
    up = max(0, side.bit_length() - 1)
    group = max(floor_level, level - up)
    blocks: dict[tm.Tile, list[tm.Tile]] = defaultdict(list)
    for t in tiles:
        blocks[tm.ancestor(t, group)].append(t)
    return [sorted(v) for _, v in sorted(blocks.items())]


def rect_of(tiles: list[tm.Tile]) -> Rect:
    """Bounding rectangle of the tiles, in tile units."""
    xs, ys = [t[1] for t in tiles], [t[2] for t in tiles]
    return min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1


def cut(block: np.ndarray, rect: Rect, tiles: list[tm.Tile], px: int = tm.TILE_PX) -> dict[tm.Tile, np.ndarray]:
    """The block's pixels (rows, cols, bands) cut back into the requested tiles."""
    x0, y0, w, h = rect
    if block.shape[0] != h * px or block.shape[1] != w * px:
        raise ValueError(f"block {block.shape[:2]} does not match rect {rect} at {px} px")
    return {t: block[(t[2] - y0) * px:(t[2] - y0 + 1) * px, (t[1] - x0) * px:(t[1] - x0 + 1) * px].copy() for t in tiles}


def split(tiles: list[tm.Tile]) -> list[list[tm.Tile]]:
    """Quarter a block's tiles by its bounding rectangle (halves when it is one tile wide or tall)."""
    x0, y0, w, h = rect_of(tiles)
    mx, my = x0 + max(1, w // 2), y0 + max(1, h // 2)
    parts: dict[tuple[bool, bool], list[tm.Tile]] = defaultdict(list)
    for t in tiles:
        parts[(t[1] >= mx, t[2] >= my)].append(t)
    return [sorted(v) for _, v in sorted(parts.items())]
