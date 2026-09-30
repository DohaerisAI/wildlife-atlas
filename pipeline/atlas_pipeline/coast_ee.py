"""Earth Engine side of the coast mask: GLO-30 WBM ocean share for a list of tiles, in big blocks (tile_blocks)."""

import logging

import numpy as np

from . import coast_mask as cm
from . import tile_math as tm
from .living_earth_v2_ee import SENTINEL
from .tiles_ee import _pull_tiles, coastal_sea

log = logging.getLogger(__name__)


def sea_image(ee, level: int):
    """The same ocean share the tile builder uses (from GLO-30's 30 m pixels), as one float band."""
    px = tm.pixel_deg(level)
    proj = ee.Projection("EPSG:4326").scale(px, px)
    return coastal_sea(ee, proj, exact=True).rename("sea").unmask(SENTINEL).toFloat()


def pull_masks(ee, tiles: list[tm.Tile], workers: int = 4, floor_level: int = 3) -> dict[tm.Tile, np.ndarray]:
    """{tile: (256, 256) uint8 mask} for every tile Earth Engine can project (others are left out)."""
    if not tiles:
        return {}
    level = tiles[0][0]
    got = _pull_tiles(ee, sea_image(ee, level), ["sea"], tiles, level, workers, "coast", None, floor_level)
    return {t: cm.share_byte(a[..., 0]) for t, a in got.items()}
