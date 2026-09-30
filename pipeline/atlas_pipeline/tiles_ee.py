"""Earth Engine side of the detail tile pyramid: one shard (a level-3 tile, 22.5 degrees) at a time.

Land-bearing tiles at the finest level are requested in big blocks (tile_blocks: up to 2048 px per call, cut into
256 px tiles on the runner; NDVI likewise at 64 px per tile). Calls run on a thread pool
against the high-volume endpoint and retry with backoff; everything is pure after `pull_shard` returns a Mosaic.
"""

import logging
import random
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from . import tile_blocks as tb
from . import tile_math as tm
from .living_earth_v2 import land_class
from .living_earth_v2_ee import _OUTSIDE, SENTINEL, _fetch
from .tile_product import Mosaic
from .tiles_ee_fine import DEM, FINE_FROM_LEVEL, NDVI_MAX_LEVEL, rgb_bytes, s2_rgb_image, s2_ndvi_image, shade_image

log = logging.getLogger(__name__)
BANDS = ["codes", "share", "sea", "tree", "elev", "ice"]
EXACT_FROM_LEVEL = 7  # at or below ~600 m pixels WorldCover mode is taken from the 10 m pixels; coarser uses its mode pyramid
_QUOTA_ON = ("too many", "429", "concurrency", "quota", "503", "unavailable")
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
    glo = ee.ImageCollection(DEM).select("DEM")
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


def quota_error(message: str) -> bool:
    """Rate and concurrency limits and transient server errors: wait them out, don't make the request smaller."""
    m = message.lower()
    return any(s in m for s in _QUOTA_ON)


def _call(ee, fn, what: str, retries: int = 8, retry=retryable):
    """Run one Earth Engine call, waiting out rate limits, timeouts and dropped connections (OSError covers
    requests/urllib3 connection errors). `retry(message)` decides which Earth Engine errors are waited out."""
    for attempt in range(retries):
        try:
            return fn()
        except (ee.EEException, OSError) as e:
            msg = str(e)
            if attempt == retries - 1 or not (isinstance(e, OSError) or retry(msg)):
                raise
            wait = min(120, 5 * 2 ** attempt) * (0.75 + 0.5 * random.random())  # jitter so shards don't retry in step
            log.warning("%s: %s; retry in %ds", what, msg[:100], wait)
            time.sleep(wait)
    raise AssertionError("unreachable")


def shard_tiles(shard: tm.Tile, level: int, land_mask: np.ndarray) -> list[tm.Tile]:
    """Finest-level tiles of the shard that hold land (pack v2 mask, grown by one pixel)."""
    land = tm.land_tiles(land_mask, level)
    return [t for t in tm.descendants(shard, level) if (t[1], t[2]) in land]


def _pull_block(ee, images: tuple, bands: list[str], tiles: list[tm.Tile], grid: tuple[int, int], px: int, what: str,
                fall_back_on_error: bool = False) -> dict:
    """{tile: (px, px, bands)} for one block, in one call when it can be. A block that times out, runs out of memory
    or crosses a source's footprint is quartered and tried again; a single tile tries `images` in order (the later
    ones are fallbacks: polar sources, or MODIS for NDVI when `fall_back_on_error`) and is skipped if none projects."""
    x0, y0, w, h = tb.rect_of(tiles)
    piece = (x0 * px, y0 * px, w * px, h * px)
    name = f"{what} {tiles[0]}" + (f" +{len(tiles) - 1}" if len(tiles) > 1 else "")
    if len(tiles) > 1:
        try:
            a = _call(ee, lambda: _fetch(ee, images[0], grid[0], grid[1], piece, bands), name, retry=quota_error)
            return tb.cut(a, (x0, y0, w, h), tiles, px)
        except ee.EEException as e:
            log.info("%s: %s; splitting", name, str(e)[:80])
        out = {}
        for part in tb.split(tiles):
            out.update(_pull_block(ee, images, bands, part, grid, px, what, fall_back_on_error))
        return out
    for i, im in enumerate(images):
        try:
            return tb.cut(_call(ee, lambda: _fetch(ee, im, grid[0], grid[1], piece, bands), name), (x0, y0, 1, 1), tiles, px)
        except ee.EEException as e:
            last = i == len(images) - 1
            if _OUTSIDE in str(e) or (fall_back_on_error and not last):
                log.warning("%s: %s; trying the next source", name, str(e)[:80])
                continue
            raise
    log.warning("%s: no source can be projected here; skipped", name)
    return {}


def _pull_tiles(ee, image, bands: list[str], todo: list[tm.Tile], level: int, workers: int, what: str, fallback=None,
                floor_level: int = 0, px: int = tm.TILE_PX, fall_back_on_error: bool = False):
    """{tile: (px, px, bands)} for every tile Earth Engine can project; tiles it can't are left out. Tiles are
    requested in blocks as large as the response budget allows (tile_blocks), never across `floor_level`."""
    grid = (px * tm.cols(level), px * tm.rows(level))
    images = (image,) if fallback is None else (image, fallback)
    blocks = tb.plan_blocks(todo, tb.block_side(len(bands), tile_px=px), floor_level)
    log.info("%s: %d tiles in %d blocks", what, len(todo), len(blocks))
    out = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_pull_block, ee, images, bands, b, grid, px, what, fall_back_on_error) for b in blocks]
        for done, f in enumerate(futures, 1):
            out.update(f.result())
            log.info("%s: %d/%d blocks, %d tiles", what, done, len(blocks), len(out))
    return out


def ndvi_level(level: int) -> int:
    """Level the NDVI is pulled at for a run whose finest level is `level`: never finer than NDVI_MAX_LEVEL."""
    return min(level, NDVI_MAX_LEVEL)


def ndvi_tiles(todo: list[tm.Tile], level: int) -> list[tm.Tile]:
    """The tiles at the NDVI level that cover `todo` (their ancestors, once each)."""
    return sorted({tm.ancestor(t, level) for t in todo})


def pull_shard(ee, shard: tm.Tile, level: int, land_mask: np.ndarray, workers: int = 8, ndvi: bool = True,
               keep=None, exact: bool | None = None) -> Mosaic:
    """Pull one shard at `level`. `keep(tile)` limits it to some tiles (validation sites). From level 9 the town-scale
    sources are used: hillshade at DEM resolution, Sentinel-2 monthly NDVI (at level 9 at most) and a Sentinel-2 true-colour mosaic."""
    exact = level >= EXACT_FROM_LEVEL if exact is None else exact
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
    for t, a in _pull_tiles(ee, image, bands, todo, level, workers, f"shard {shard} land", polar, shard[0]).items():
        y, x = at(t)
        sl = (slice(y, y + tm.TILE_PX), slice(x, x + tm.TILE_PX))
        cls[sl] = land_class(a[..., 0], a[..., 1], a[..., 2], a[..., 5])
        tree[sl], elev[sl] = a[..., 3], a[..., 4]
        if shade is not None:
            shade[sl] = a[..., 6]
    if rgb is not None:
        for t, a in _pull_tiles(ee, s2_rgb_image(ee, level), ["r", "g", "b"], todo, level, workers, f"shard {shard} rgb", None, shard[0]).items():
            y, x = at(t)
            rgb[y:y + tm.TILE_PX, x:x + tm.TILE_PX] = rgb_bytes(a)
    nl = ndvi_level(level)
    months = pull_ndvi(ee, shard, nl, ndvi_tiles(todo, nl), workers, s2_ndvi_image(ee, nl) if nl >= FINE_FROM_LEVEL else None) if ndvi else None
    return Mosaic(shard, level, cls, tree, elev, months, shade=shade, rgb=rgb, ndvi_level=nl)


def pull_ndvi(ee, shard: tm.Tile, level: int, land: list[tm.Tile], workers: int, image=None) -> np.ndarray:
    """(12, n/4, n/4) NDVI over the shard at 64 px per finest tile, pulled in blocks of land tiles. With a Sentinel-2
    `image`, a tile whose Sentinel-2 medians fail falls back to MODIS on its own."""
    px = 64
    m = px * 2 ** (level - shard[0])
    out = np.full((12, m, m), np.nan)
    modis = ndvi_image(ee)
    images = (image, modis) if image is not None else (modis,)
    bands = [f"m{i}" for i in range(1, 13)]
    t0 = tm.descendants(shard, level)[0]
    got = _pull_tiles(ee, images[0], bands, land, level, workers, f"shard {shard} ndvi", images[1] if len(images) > 1 else None,
                      shard[0], px=px, fall_back_on_error=image is not None)
    for t, a in got.items():
        x, y = (t[1] - t0[1]) * px, (t[2] - t0[2]) * px
        out[:, y:y + px, x:x + px] = np.moveaxis(a, -1, 0)
    log.info("shard %s: ndvi for %d of %d tiles", shard, len(got), len(land))
    return out
