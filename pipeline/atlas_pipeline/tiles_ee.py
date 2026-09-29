"""Earth Engine side of the detail tile pyramid: one shard (a level-3 tile, 22.5 degrees) at a time.

Every land-bearing tile at the finest level is one computePixels call (256 x 256, bands below); NDVI comes in
256 x 256 pieces of 64 px per finest tile (so one call covers 4 x 4 finest tiles). Calls run on a thread pool
against the high-volume endpoint and retry with backoff; everything is pure after `pull_shard` returns a Mosaic.
"""

import logging
import random
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from . import tile_math as tm
from .living_earth_v2 import land_class
from .living_earth_v2_ee import _OUTSIDE, SENTINEL, _fetch
from .tile_product import Mosaic
from .tiles_ee_fine import FINE_FROM_LEVEL, rgb_bytes, s2_rgb_image, s2_ndvi_image, shade_image

log = logging.getLogger(__name__)
BANDS = ["codes", "share", "sea", "tree", "elev", "ice"]
EXACT_FROM_LEVEL = 7  # at or below ~600 m pixels WorldCover mode is taken from the 10 m pixels; coarser uses its mode pyramid
_RETRY_ON = ("too many", "429", "concurrency", "timed out", "deadline", "internal error", "503", "unavailable", "memory")


def polar_image(ee, level: int, exact: bool):
    """Fallback near the poles, where HYCOM, MODIS and GLO-30 composites fail to reproject ("Unable to transform
    edge"): WorldCover class and share as usual, no sea mask or tree cover, ETOPO1 for elevation and ice."""
    px = tm.pixel_deg(level)
    proj = ee.Projection("EPSG:4326").scale(px, px)
    wc = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map")
    codes = wc.reduceResolution(ee.Reducer.mode(), False, 65535).reproject(proj) if exact else wc.reproject(proj)
    share = wc.mask().unmask(0).reproject(proj)
    etopo = ee.Image("NOAA/NGDC/ETOPO1").toFloat()
    zero = ee.Image.constant(0).reproject(proj)
    parts = [codes, share, zero, zero, etopo.select("ice_surface").reproject(proj), etopo.select("ice_surface").subtract(etopo.select("bedrock")).reproject(proj)]
    return ee.Image.cat([p.rename(b).unmask(SENTINEL).toFloat() for p, b in zip(parts, BANDS)])


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


def retryable(message: str) -> bool:
    """Earth Engine errors worth waiting out: rate and concurrency limits, timeouts, transient server errors."""
    m = message.lower()
    return any(s in m for s in _RETRY_ON)


def _call(ee, fn, what: str, retries: int = 8):
    for attempt in range(retries):
        try:
            return fn()
        except ee.EEException as e:
            msg = str(e)
            if attempt == retries - 1 or not retryable(msg):
                raise
            wait = min(120, 5 * 2 ** attempt) * (0.75 + 0.5 * random.random())  # jitter so shards don't retry in step
            log.warning("%s: %s; retry in %ds", what, msg[:100], wait)
            time.sleep(wait)
    raise AssertionError("unreachable")


def shard_tiles(shard: tm.Tile, level: int, land_mask: np.ndarray) -> list[tm.Tile]:
    """Finest-level tiles of the shard that hold land (pack v2 mask, grown by one pixel)."""
    land = tm.land_tiles(land_mask, level)
    return [t for t in tm.descendants(shard, level) if (t[1], t[2]) in land]


def _pull_tiles(ee, image, bands: list[str], todo: list[tm.Tile], level: int, workers: int, what: str, fallback=None):
    """{tile: (256, 256, bands)} for every tile Earth Engine can project; tiles it can't are left out."""
    width, height = tm.TILE_PX * tm.cols(level), tm.TILE_PX * tm.rows(level)

    def one(t: tm.Tile):
        piece = (t[1] * tm.TILE_PX, t[2] * tm.TILE_PX, tm.TILE_PX, tm.TILE_PX)
        for im in (image, fallback) if fallback is not None else (image,):
            try:
                return t, _call(ee, lambda: _fetch(ee, im, width, height, piece, bands), f"{what} {t}")
            except ee.EEException as e:
                if _OUTSIDE not in str(e):
                    raise
        log.warning("%s %s: no source can be projected here; skipped", what, t)
        return t, None

    out = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for done, (t, a) in enumerate(pool.map(one, todo), 1):
            if a is not None:
                out[t] = a
            if done % 50 == 0 or done == len(todo):
                log.info("%s: %d/%d tiles", what, done, len(todo))
    return out


def pull_shard(ee, shard: tm.Tile, level: int, land_mask: np.ndarray, workers: int = 8, ndvi: bool = True,
               keep=None) -> Mosaic:
    """Pull one shard at `level`. `keep(tile)` limits it to some tiles (validation sites). From level 9 the town-scale
    sources are used: hillshade at DEM resolution, Sentinel-2 monthly NDVI and a Sentinel-2 true-colour mosaic."""
    exact = level >= EXACT_FROM_LEVEL
    fine = level >= FINE_FROM_LEVEL
    todo = [t for t in shard_tiles(shard, level, land_mask) if keep is None or keep(t)]
    n = tm.TILE_PX * 2 ** (level - shard[0])
    ox, oy = shard[1] * n, shard[2] * n  # shard origin in the level's global pixel grid
    cls = np.zeros((n, n), dtype=np.uint8)
    tree, elev = np.full((n, n), np.nan), np.full((n, n), np.nan)
    shade = np.full((n, n), np.nan) if fine else None
    rgb = np.zeros((n, n, 3), dtype=np.uint8) if fine else None
    log.info("shard %s: %d land tiles at level %d (exact class: %s, town sources: %s)", shard, len(todo), level, exact, fine)
    bands = BANDS + (["shade"] if fine else [])
    image = ee.Image.cat([land_image(ee, level, exact), shade_image(ee, level).unmask(SENTINEL)]) if fine else land_image(ee, level, exact)
    polar = ee.Image.cat([polar_image(ee, level, exact), shade_image(ee, level).unmask(SENTINEL)]) if fine else polar_image(ee, level, exact)
    at = lambda t: (t[2] * tm.TILE_PX - oy, t[1] * tm.TILE_PX - ox)  # noqa: E731
    for t, a in _pull_tiles(ee, image, bands, todo, level, workers, f"shard {shard} land", polar).items():
        y, x = at(t)
        sl = (slice(y, y + tm.TILE_PX), slice(x, x + tm.TILE_PX))
        cls[sl] = land_class(a[..., 0], a[..., 1], a[..., 2], a[..., 5])
        tree[sl], elev[sl] = a[..., 3], a[..., 4]
        if shade is not None:
            shade[sl] = a[..., 6]
    if rgb is not None:
        for t, a in _pull_tiles(ee, s2_rgb_image(ee, level), ["r", "g", "b"], todo, level, workers, f"shard {shard} rgb").items():
            y, x = at(t)
            rgb[y:y + tm.TILE_PX, x:x + tm.TILE_PX] = rgb_bytes(a)
    months = pull_ndvi(ee, shard, level, todo, workers, s2_ndvi_image(ee, level) if fine else None) if ndvi else None
    return Mosaic(shard, level, cls, tree, elev, months, shade=shade, rgb=rgb)


def pull_ndvi(ee, shard: tm.Tile, level: int, land: list[tm.Tile], workers: int, image=None) -> np.ndarray:
    """(12, n/4, n/4) NDVI over the shard at 64 px per finest tile, pulled in 256 px pieces that touch land."""
    group = max(shard[0], level - 2)  # a group tile is 256 px on the NDVI grid
    per = 2 ** (level - group)  # finest tiles per group side
    m = 64 * 2 ** (level - shard[0])
    out = np.full((12, m, m), np.nan)
    width, height = 64 * tm.cols(level), 64 * tm.rows(level)
    groups = sorted({tm.ancestor(t, group) for t in land})
    side = 64 * per
    expr = image if image is not None else ndvi_image(ee)
    bands = [f"m{i}" for i in range(1, 13)]
    g0 = tm.descendants(shard, group)[0]

    def one(g: tm.Tile):
        piece = (g[1] * side, g[2] * side, side, side)
        try:
            return g, _call(ee, lambda: _fetch(ee, expr, width, height, piece, bands), f"ndvi {g}")
        except ee.EEException as e:
            if _OUTSIDE not in str(e):
                raise
            log.warning("ndvi %s: MODIS can't be projected here; the pack's NDVI is used", g)
            return g, None

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for g, a in pool.map(one, groups):
            if a is None:
                continue
            x, y = (g[1] - g0[1]) * side, (g[2] - g0[2]) * side
            out[:, y:y + side, x:x + side] = np.moveaxis(a, -1, 0)
    log.info("shard %s: ndvi from %d pieces", shard, len(groups))
    return out
