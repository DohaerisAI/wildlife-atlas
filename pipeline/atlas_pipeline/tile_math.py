"""Geographic (EPSG:4326) tile quadtree shared by the pipeline and the engine (web/src/engine/tiles/tile-math.ts).

Level z has 2^(z+1) columns and 2^z rows of square tiles, each 180/2^z degrees on a side and TILE_PX pixels wide.
x counts east from 180W, y counts south from 90N. Level 0 is two tiles: the western and eastern hemispheres.
The availability index is a bitset per level (bit i = y * cols + x, least significant bit first), base64 encoded.
"""

import base64
import math

import numpy as np

TILE_PX = 256

Bounds = tuple[float, float, float, float]  # west, south, east, north (degrees)
Tile = tuple[int, int, int]  # z, x, y


def cols(z: int) -> int:
    return 2 ** (z + 1)


def rows(z: int) -> int:
    return 2 ** z


def span(z: int) -> float:
    """Tile edge in degrees."""
    return 180.0 / 2 ** z


def pixel_deg(z: int) -> float:
    return span(z) / TILE_PX


def pixel_km(z: int) -> float:
    """Pixel height on the ground (km), the same at every latitude in this scheme."""
    return pixel_deg(z) * 111.32


def check(tile: Tile) -> Tile:
    z, x, y = tile
    if z < 0 or not (0 <= x < cols(z)) or not (0 <= y < rows(z)):
        raise ValueError(f"tile {tile} is outside the level {z} grid")
    return tile


def bounds(tile: Tile) -> Bounds:
    z, x, y = check(tile)
    s = span(z)
    west, north = -180.0 + x * s, 90.0 - y * s
    return west, north - s, west + s, north


def tile_at(lng: float, lat: float, z: int) -> Tile:
    s = span(z)
    x = min(cols(z) - 1, max(0, math.floor((lng + 180.0) / s)))
    y = min(rows(z) - 1, max(0, math.floor((90.0 - lat) / s)))
    return z, x, y


def children(tile: Tile) -> list[Tile]:
    z, x, y = check(tile)
    return [(z + 1, 2 * x + dx, 2 * y + dy) for dy in (0, 1) for dx in (0, 1)]


def parent(tile: Tile) -> Tile:
    z, x, y = check(tile)
    if z == 0:
        raise ValueError("level 0 tiles have no parent")
    return z - 1, x // 2, y // 2


def ancestor(tile: Tile, level: int) -> Tile:
    z, x, y = check(tile)
    if not 0 <= level <= z:
        raise ValueError(f"level {level} is not above tile {tile}")
    k = z - level
    return level, x >> k, y >> k


def descendants(tile: Tile, level: int) -> list[Tile]:
    """Every tile at `level` inside `tile`, row-major."""
    z, x, y = check(tile)
    if level < z:
        raise ValueError("descendants must be at or below the tile's level")
    n = 2 ** (level - z)
    return [(level, x * n + i, y * n + j) for j in range(n) for i in range(n)]


def tiles_in_bbox(z: int, bbox: Bounds) -> list[Tile]:
    """Tiles at level z that overlap bbox (west, south, east, north), row-major."""
    west, south, east, north = bbox
    if west >= east or south >= north:
        raise ValueError("bbox must have west < east and south < north")
    s = span(z)
    x0 = max(0, math.floor((west + 180.0) / s))
    x1 = min(cols(z), math.ceil((east + 180.0) / s))
    y0 = max(0, math.floor((90.0 - north) / s))
    y1 = min(rows(z), math.ceil((90.0 - south) / s))
    return [(z, x, y) for y in range(y0, y1) for x in range(x0, x1)]


def land_tiles(land: np.ndarray, z: int, dilate: int = 1) -> set[tuple[int, int]]:
    """(x, y) of level-z tiles holding any land in a global equirectangular boolean mask (180W, 90N at top left).
    The mask is grown by `dilate` of its own pixels first so coasts and small islands just under a pixel are kept."""
    m = np.asarray(land, dtype=bool)
    if dilate > 0:
        grown = m.copy()
        for dy in range(-dilate, dilate + 1):
            for dx in range(-dilate, dilate + 1):
                grown |= np.roll(np.roll(m, dy, axis=0), dx, axis=1)
        m = grown
    h, w = m.shape
    c, r = cols(z), rows(z)
    if h % r == 0 and w % c == 0:
        hit = m.reshape(r, h // r, c, w // c).any(axis=(1, 3))
    else:  # tiles finer than the mask: each tile reads the mask pixel under it
        ys = np.minimum(h - 1, ((np.arange(r) + 0.5) * h / r).astype(int))
        xs = np.minimum(w - 1, ((np.arange(c) + 0.5) * w / c).astype(int))
        hit = m[np.ix_(ys, xs)]
    yy, xx = np.nonzero(hit)
    return {(int(x), int(y)) for x, y in zip(xx, yy)}


def encode_index(z: int, present: set[tuple[int, int]]) -> str:
    bits = np.zeros(cols(z) * rows(z), dtype=np.uint8)
    for x, y in present:
        check((z, x, y))
        bits[y * cols(z) + x] = 1
    return base64.b64encode(np.packbits(bits, bitorder="little").tobytes()).decode("ascii")


def decode_index(z: int, encoded: str) -> set[tuple[int, int]]:
    raw = np.frombuffer(base64.b64decode(encoded), dtype=np.uint8)
    bits = np.unpackbits(raw, bitorder="little")[: cols(z) * rows(z)]
    return {(int(i % cols(z)), int(i // cols(z))) for i in np.nonzero(bits)[0]}


def plan_shards(land: np.ndarray, bbox: Bounds, shard_level: int = 3) -> list[Tile]:
    """Shard tiles (default level 3, 22.5 degrees) that overlap bbox and hold land, row-major."""
    has_land = land_tiles(land, shard_level)
    return [t for t in tiles_in_bbox(shard_level, bbox) if (t[1], t[2]) in has_land]


def parse_bbox(text: str) -> Bounds:
    """'W,S,E,N' in degrees."""
    w, s, e, n = (float(v) for v in text.split(","))
    if not (w < e and s < n):
        raise ValueError(f"bbox {text!r} must be W,S,E,N with W < E and S < N")
    return w, s, e, n


def parse_tile(text: str) -> Tile:
    """'z/x/y' to a checked tile."""
    parts = text.strip().split("/")
    if len(parts) != 3:
        raise ValueError(f"tile must be z/x/y, got {text!r}")
    return check((int(parts[0]), int(parts[1]), int(parts[2])))


def site_boxes(text: str, level: int = 9, radius: int = 1) -> list[Bounds]:
    """'lng,lat;lng,lat' to boxes of (2r+1)^2 level-9 tiles around each point (whole tiles, so levels 9+ are complete)."""
    boxes = []
    for part in filter(None, (p.strip() for p in text.split(";"))):
        lng, lat = (float(v) for v in part.split(","))
        _, x, y = tile_at(lng, lat, level)
        w, _, _, n = bounds((level, max(0, x - radius), max(0, y - radius)))
        _, s, e, _ = bounds((level, min(cols(level) - 1, x + radius), min(rows(level) - 1, y + radius)))
        boxes.append((w, s, e, n))
    return boxes


def inside_any(t: Tile, boxes: list[Bounds]) -> bool:
    w, s, e, n = bounds(t)
    return any(w >= bw - 1e-9 and e <= be + 1e-9 and s >= bs - 1e-9 and n <= bn + 1e-9 for bw, bs, be, bn in boxes)
