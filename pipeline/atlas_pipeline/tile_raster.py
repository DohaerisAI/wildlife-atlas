"""Pure raster steps for the tile pyramid: downsampling, hillshade from a DEM, the monthly NDVI tile atlas.

A land tile is 256 x 256 RGB, the same encoding as pack v2 land.png: R = class index, G = tree cover byte,
B = hillshade (181 = flat). An NDVI tile is a 4 x 3 atlas of 12 monthly 64 x 64 frames, grey,
0 = no data and 1..255 = -0.2..0.9 (living_earth SURFACE ndvi channel).
"""

import math

import numpy as np

from .living_earth import SURFACE
from .living_earth_v2 import LAND_CLASSES, to_byte_flagged

N_CLASSES = len(LAND_CLASSES)
NDVI = SURFACE[2]
NDVI_PX = 64
FLAT_SHADE = 181
SUN_AZIMUTH = 315.0
SUN_ALTITUDE = 45.0
KM_PER_DEG = 111.32


def _blocks(a: np.ndarray, f: int) -> np.ndarray:
    h, w = a.shape[:2]
    if f < 1 or h % f or w % f:
        raise ValueError(f"{a.shape} does not divide into {f} x {f} blocks")
    return a.reshape(h // f, f, w // f, f, *a.shape[2:])


def block_mode(classes: np.ndarray, f: int) -> np.ndarray:
    """Most common class in each f x f block. Land beats ocean (0) whenever any land is present, so coasts
    and small islands survive coarser levels; ties go to the lower class index."""
    b = _blocks(np.asarray(classes, dtype=np.uint8), f)
    counts = np.stack([(b == c).sum(axis=(1, 3)) for c in range(N_CLASSES)], axis=-1)
    land = counts[..., 1:]
    best_land = land.argmax(axis=-1) + 1
    return np.where(land.sum(axis=-1) > 0, best_land, 0).astype(np.uint8)


def block_mean(values: np.ndarray, f: int) -> np.ndarray:
    """NaN-aware mean of f x f blocks; all-NaN blocks stay NaN."""
    b = _blocks(np.asarray(values, dtype=np.float64), f)
    count = (~np.isnan(b)).sum(axis=(1, 3))
    total = np.nansum(b, axis=(1, 3))
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(count > 0, total / np.maximum(count, 1), np.nan)


def exaggeration(level: int) -> float:
    """Vertical exaggeration for hillshade at a level: pack v2 uses 8x at ~10 km pixels; finer pixels need less
    because real slopes are steeper at short range. Scales with sqrt(pixel size), kept within 1.5..8."""
    px_km = 180.0 / 2 ** level / 256 * KM_PER_DEG
    return float(min(8.0, max(1.5, 8.0 * math.sqrt(px_km / 10.0))))


def hillshade(elev_m: np.ndarray, px_deg: float, north_lat: float, exag: float) -> np.ndarray:
    """Shaded relief bytes (azimuth 315, altitude 45, as ee.Terrain.hillshade; flat = 181) of a north-up grid
    whose top row is at `north_lat`. NaN elevation counts as sea level. Edges repeat their neighbours."""
    z = np.nan_to_num(np.asarray(elev_m, dtype=np.float64), nan=0.0) * exag
    h = z.shape[0]
    lat = north_lat - (np.arange(h) + 0.5) * px_deg
    dy = px_deg * KM_PER_DEG * 1000.0
    dx = np.maximum(dy * np.cos(np.radians(lat)), 1.0)[:, None]
    gy, gx = np.gradient(z)
    # gradient per metre; +y in the array is south
    sx, sy = gx / dx, -gy / dy
    zen = math.radians(90.0 - SUN_ALTITUDE)
    az = math.radians(SUN_AZIMUTH)
    slope = np.arctan(np.hypot(sx, sy))
    aspect = np.arctan2(-sx, -sy)  # direction the slope faces, clockwise from north
    shade = np.cos(zen) * np.cos(slope) + np.sin(zen) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(np.round(255.0 * np.clip(shade, 0.0, 1.0)), 0, 255).astype(np.uint8)


def ndvi_atlas(months: np.ndarray) -> np.ndarray:
    """(12, 64, 64) NDVI values (NaN = no data) to one (192, 256) grey atlas, Jan..Dec row-major, 4 x 3."""
    m = np.asarray(months, dtype=np.float64)
    if m.shape != (12, NDVI_PX, NDVI_PX):
        raise ValueError(f"expected (12, {NDVI_PX}, {NDVI_PX}) months, got {m.shape}")
    b = to_byte_flagged(m, NDVI)
    return b.reshape(3, 4, NDVI_PX, NDVI_PX).transpose(0, 2, 1, 3).reshape(3 * NDVI_PX, 4 * NDVI_PX)


def land_rgb(classes: np.ndarray, tree_byte: np.ndarray, shade: np.ndarray) -> np.ndarray:
    cls = np.asarray(classes, dtype=np.uint8)
    tree = np.where(cls == 0, 0, np.asarray(tree_byte, dtype=np.uint8))
    return np.stack([cls, tree.astype(np.uint8), np.asarray(shade, dtype=np.uint8)], axis=-1)


def resample_nearest(a: np.ndarray, out_h: int, out_w: int) -> np.ndarray:
    """Nearest-neighbour resize (used to cut the 10 km pack into finer world tiles)."""
    h, w = a.shape[:2]
    ys = np.minimum(h - 1, ((np.arange(out_h) + 0.5) * h / out_h).astype(int))
    xs = np.minimum(w - 1, ((np.arange(out_w) + 0.5) * w / out_w).astype(int))
    return a[np.ix_(ys, xs)]


def resample_bilinear(a: np.ndarray, out_h: int, out_w: int) -> np.ndarray:
    """Bilinear resize of a 2-D float array, pixel centres aligned (edges clamp)."""
    src = np.asarray(a, dtype=np.float64)
    h, w = src.shape
    y = np.clip((np.arange(out_h) + 0.5) * h / out_h - 0.5, 0, h - 1)
    x = np.clip((np.arange(out_w) + 0.5) * w / out_w - 0.5, 0, w - 1)
    y0, x0 = np.floor(y).astype(int), np.floor(x).astype(int)
    y1, x1 = np.minimum(y0 + 1, h - 1), np.minimum(x0 + 1, w - 1)
    fy, fx = (y - y0)[:, None], (x - x0)[None, :]
    top = src[np.ix_(y0, x0)] * (1 - fx) + src[np.ix_(y0, x1)] * fx
    bot = src[np.ix_(y1, x0)] * (1 - fx) + src[np.ix_(y1, x1)] * fx
    return top * (1 - fy) + bot * fy
