"""Earth Engine side of the detail tile pyramid: one shard (a level-3 tile, 22.5 degrees) at a time.

Every land-bearing tile at the finest level is one computePixels call (256 x 256, bands below); NDVI comes in
256 x 256 pieces of 64 px per finest tile (so one call covers 4 x 4 finest tiles). Calls run on a thread pool
against the high-volume endpoint and retry with backoff; everything is pure after `pull_shard` returns a Mosaic.
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from . import tile_math as tm
from .living_earth_v2 import land_class
from .living_earth_v2_ee import SENTINEL, _fetch
from .tile_product import Mosaic

log = logging.getLogger(__name__)
BANDS = ["codes", "share", "sea", "tree", "elev", "ice"]
EXACT_FROM_LEVEL = 7  # at or below ~600 m pixels WorldCover mode is taken from the 10 m pixels; coarser uses its mode pyramid
_RETRY_ON = ("Too many", "429", "timed out", "deadline", "Internal error", "503", "unavailable", "memory")


def land_image(ee, level: int, exact: bool):
    px = tm.pixel_deg(level)
    proj = ee.Projection("EPSG:4326").scale(px, px)
    wc = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map")
    codes = wc.reduceResolution(ee.Reducer.mode(), False, 65535).reproject(proj) if exact else wc.reproject(proj)
    share = wc.mask().unmask(0).reduceResolution(ee.Reducer.mean(), False, 65535).reproject(proj) if exact else wc.mask().unmask(0).reproject(proj)
    sea = ee.ImageCollection("HYCOM/sea_water_velocity").filterDate("2020-07-01", "2020-07-02").first().select("velocity_u_0").mask().unmask(0)
    tree = (ee.ImageCollection("MODIS/061/MOD44B").filterDate("2020-01-01", "2025-01-01").select("Percent_Tree_Cover")
            .map(lambda im: im.updateMask(im.lte(100))).mean())
    glo = ee.ImageCollection("COPERNICUS/DEM/GLO30").select("DEM")
    etopo = ee.Image("NOAA/NGDC/ETOPO1").toFloat()
    dem = glo.mosaic().setDefaultProjection(glo.first().projection()).reproject(proj).unmask(etopo.select("ice_surface").reproject(proj))
    ice = etopo.select("ice_surface").subtract(etopo.select("bedrock"))
    parts = [codes, share, sea.reproject(proj), tree.reproject(proj), dem, ice.reproject(proj)]
    return ee.Image.cat([p.rename(b).unmask(SENTINEL).toFloat() for p, b in zip(parts, BANDS)])


def ndvi_image(ee):
    col = ee.ImageCollection("MODIS/061/MOD13A2").filterDate("2015-01-01", "2025-01-01").select("NDVI")
    months = [col.filter(ee.Filter.calendarRange(m, m, "month")).mean().multiply(0.0001).rename(f"m{m}") for m in range(1, 13)]
    return ee.Image.cat([m.unmask(SENTINEL).toFloat() for m in months])


def _call(ee, fn, what: str, retries: int = 6):
    for attempt in range(retries):
        try:
            return fn()
        except ee.EEException as e:
            msg = str(e)
            if attempt == retries - 1 or not any(s in msg for s in _RETRY_ON):
                raise
            wait = min(120, 5 * 2 ** attempt)
            log.warning("%s: %s; retry in %ds", what, msg[:100], wait)
            time.sleep(wait)
    raise AssertionError("unreachable")


def shard_tiles(shard: tm.Tile, level: int, land_mask: np.ndarray) -> list[tm.Tile]:
    """Finest-level tiles of the shard that hold land (pack v2 mask, grown by one pixel)."""
    land = tm.land_tiles(land_mask, level)
    return [t for t in tm.descendants(shard, level) if (t[1], t[2]) in land]


def pull_shard(ee, shard: tm.Tile, level: int, land_mask: np.ndarray, workers: int = 8, ndvi: bool = True) -> Mosaic:
    exact = level >= EXACT_FROM_LEVEL
    todo = shard_tiles(shard, level, land_mask)
    n = tm.TILE_PX * 2 ** (level - shard[0])
    width, height = tm.TILE_PX * tm.cols(level), tm.TILE_PX * tm.rows(level)
    ox, oy = shard[1] * n, shard[2] * n  # shard origin in the level's global pixel grid
    cls = np.zeros((n, n), dtype=np.uint8)
    tree = np.full((n, n), np.nan)
    elev = np.full((n, n), np.nan)
    expr = land_image(ee, level, exact)
    log.info("shard %s: %d land tiles at level %d (exact class: %s)", shard, len(todo), level, exact)

    def one(t: tm.Tile):
        piece = (t[1] * tm.TILE_PX, t[2] * tm.TILE_PX, tm.TILE_PX, tm.TILE_PX)
        return t, _call(ee, lambda: _fetch(ee, expr, width, height, piece, BANDS), f"tile {t}")

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for done, (t, a) in enumerate(pool.map(one, todo), 1):
            x, y = t[1] * tm.TILE_PX - ox, t[2] * tm.TILE_PX - oy
            codes, share, sea, tr, el, ice = (a[..., i] for i in range(len(BANDS)))
            cls[y:y + tm.TILE_PX, x:x + tm.TILE_PX] = land_class(codes, share, sea, ice)
            tree[y:y + tm.TILE_PX, x:x + tm.TILE_PX] = tr
            elev[y:y + tm.TILE_PX, x:x + tm.TILE_PX] = el
            if done % 50 == 0 or done == len(todo):
                log.info("shard %s: %d/%d tiles", shard, done, len(todo))
    months = pull_ndvi(ee, shard, level, todo, workers) if ndvi else None
    return Mosaic(shard, level, cls, tree, elev, months)


def pull_ndvi(ee, shard: tm.Tile, level: int, land: list[tm.Tile], workers: int) -> np.ndarray:
    """(12, n/4, n/4) NDVI over the shard at 64 px per finest tile, pulled in 256 px pieces that touch land."""
    group = max(shard[0], level - 2)  # a group tile is 256 px on the NDVI grid
    per = 2 ** (level - group)  # finest tiles per group side
    m = 64 * 2 ** (level - shard[0])
    out = np.full((12, m, m), np.nan)
    width, height = 64 * tm.cols(level), 64 * tm.rows(level)
    groups = sorted({tm.ancestor(t, group) for t in land})
    side = 64 * per
    expr = ndvi_image(ee)
    bands = [f"m{i}" for i in range(1, 13)]
    g0 = tm.descendants(shard, group)[0]

    def one(g: tm.Tile):
        piece = (g[1] * side, g[2] * side, side, side)
        return g, _call(ee, lambda: _fetch(ee, expr, width, height, piece, bands), f"ndvi {g}")

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for g, a in pool.map(one, groups):
            x, y = (g[1] - g0[1]) * side, (g[2] - g0[2]) * side
            out[:, y:y + side, x:x + side] = np.moveaxis(a, -1, 0)
    log.info("shard %s: ndvi from %d pieces", shard, len(groups))
    return out
