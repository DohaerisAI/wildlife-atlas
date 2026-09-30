"""Earth Engine side of the coast mask: GLO-30 WBM ocean share for a list of tiles, in big blocks (tile_blocks)."""

import json
import logging
import os

import numpy as np

from . import coast_mask as cm
from . import tile_math as tm
from .living_earth_v2_ee import SENTINEL
from .tiles_ee import COAST_WBM_OCEAN, _pull_tiles
from .tiles_ee_fine import DEM

log = logging.getLogger(__name__)
SAMPLE_LEVELS = 2  # ocean share from 4 x 4 samples of GLO-30 WBM per tile pixel (level + 2 grid)
DEFAULT_PROJECT = "atlas-earth-engine-510018"
EE_SCOPES = ["https://www.googleapis.com/auth/earthengine", "https://www.googleapis.com/auth/cloud-platform"]


def sea_image(ee, level: int):
    """Ocean share per tile pixel from 4 x 4 nearest samples of GLO-30 WBM (1 = ocean). Averaging all ~100 of its
    30 m pixels (the builder's `coastal_sea`) makes Earth Engine hold ~1 GB per 2048 px block ("Object too large")
    and took 32 minutes for 24 tiles; 16 samples resolve the share to 1/16, plenty for the 0.5 sea threshold."""
    fine, px = tm.pixel_deg(level + SAMPLE_LEVELS), tm.pixel_deg(level)
    glo = ee.ImageCollection(DEM).select("WBM")
    wbm = glo.mosaic().setDefaultProjection(glo.first().projection())
    ocean = wbm.eq(COAST_WBM_OCEAN).unmask(0).reproject(ee.Projection("EPSG:4326").scale(fine, fine))
    share = ocean.reduceResolution(ee.Reducer.mean(), False, 4 ** SAMPLE_LEVELS).reproject(ee.Projection("EPSG:4326").scale(px, px))
    return share.unmask(0).rename("sea").unmask(SENTINEL).toFloat()


def initialize(ee) -> None:
    """Service account key from EE_SERVICE_ACCOUNT_KEY (CI), else the machine's own Google login
    (`gcloud auth application-default login`). Project from EE_PROJECT, default the atlas project."""
    project = os.environ.get("EE_PROJECT", DEFAULT_PROJECT)
    key = os.environ.get("EE_SERVICE_ACCOUNT_KEY")
    if key:
        creds = ee.ServiceAccountCredentials(json.loads(key)["client_email"], key_data=key)
    else:
        import google.auth

        creds, _ = google.auth.default(scopes=EE_SCOPES)
    ee.Initialize(creds, project=project, opt_url="https://earthengine-highvolume.googleapis.com")


def pull_masks(ee, tiles: list[tm.Tile], workers: int = 4, floor_level: int = 3) -> dict[tm.Tile, np.ndarray]:
    """{tile: (256, 256) uint8 mask} for every tile Earth Engine can project (others are left out)."""
    if not tiles:
        return {}
    level = tiles[0][0]
    got = _pull_tiles(ee, sea_image(ee, level), ["sea"], tiles, level, workers, "coast", None, floor_level)
    return {t: cm.share_byte(a[..., 0]) for t, a in got.items()}
