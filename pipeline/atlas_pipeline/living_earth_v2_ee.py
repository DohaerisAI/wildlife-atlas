"""Earth Engine side of Living Earth pack v2: build expressions, pull them in tiles, hand arrays to living_earth_v2.

Findings from scripts/ee_probe_v2.py that shape this file:
- WorldCover pyramids are MODE, but mode-of-modes drifts (83-93 % of cells match the 100 m majority). Reducing a
  ~1 km level with Reducer.mode matches 99-100 %, at a memory cost, so the land layer is pulled in small tiles.
- HYCOM is 3-hourly; a 10-year monthly mean of daily fields exceeds EE memory, one year at a time does not.
  Years are averaged here (NaN-aware). HYCOM ends 2024-09.
- VIIRS average_masked is 0 (not masked) where background was removed; its mask is 1 everywhere.
- Masked pixels come back from computePixels as 0, so every band is unmasked to SENTINEL and turned into NaN.
"""

import logging
import time

import numpy as np

from .living_earth_v2 import (HILLSHADE_EXAGGERATION, LAND_SIZE, OCEAN_SIZE, RELIEF_SIZE, land_image, nanmean_stack,
                              ocean_frame, relief_image, split_tile, stitch, tile_grid, tiles)

log = logging.getLogger(__name__)
SENTINEL = -1e6  # below any real value, including the deepest sea floor (-10.9 km)
YEARS = range(2015, 2025)
_SPLIT_ON = ("memory", "too large", "exceeds", "timed out", "Too many")


def pull(ee, image, width: int, height: int, bands: list[str], tile: tuple[int, int], retries: int = 4) -> np.ndarray:
    """Pull `bands` of `image` on the global width x height grid, tile by tile; SENTINEL becomes NaN.
    A piece Earth Engine calls too big is halved; other errors retry with backoff."""
    expr = ee.Image.cat([image.select(b).unmask(SENTINEL).toFloat() for b in bands])
    queue, pieces = tiles(width, height, *tile), []
    while queue:
        piece = queue.pop(0)
        for attempt in range(retries):
            try:
                arr = ee.data.computePixels({"expression": expr, "fileFormat": "NUMPY_NDARRAY", "grid": tile_grid(width, height, piece)})
                data = np.stack([arr[b].astype("float64") for b in bands], axis=-1)
                pieces.append((piece, np.where(data <= SENTINEL + 0.5, np.nan, data)))
                break
            except ee.EEException as e:
                msg = str(e)
                if any(s in msg for s in _SPLIT_ON) and piece[2] * piece[3] > 64:
                    log.info("splitting %s: %s", piece, msg[:80])
                    queue = split_tile(piece) + queue
                    break
                if attempt == retries - 1:
                    raise
                log.warning("retrying %s after %s", piece, msg[:120])
                time.sleep(5 * 2 ** attempt)
    return stitch(pieces, width, height)


def compute_land(ee) -> np.ndarray:
    wc = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map")
    km = ee.Projection("EPSG:4326").scale(1 / 112, 1 / 112)
    majority = wc.reproject(km).reduceResolution(ee.Reducer.mode(), False, 65535).rename("cls")
    sea = ee.ImageCollection("HYCOM/sea_water_velocity").filterDate("2020-07-01", "2020-07-02").first().select("velocity_u_0").mask().rename("sea")
    tree = (ee.ImageCollection("MODIS/061/MOD44B").filterDate("2020-01-01", "2025-01-01").select("Percent_Tree_Cover")
            .map(lambda im: im.updateMask(im.lte(100))).mean().rename("tree"))
    elev = ee.Image("NOAA/NGDC/ETOPO1").select("ice_surface").toFloat()
    shade = ee.Terrain.hillshade(elev.multiply(HILLSHADE_EXAGGERATION)).rename("shade")
    cheap = ee.Image.cat(wc.mask().unmask(0).rename("share"), sea.unmask(0), tree, shade)
    w, h = LAND_SIZE
    rest = pull(ee, cheap, w, h, ["share", "sea", "tree", "shade"], (w, 256))
    log.info("land: share, sea, tree, shade pulled")
    cls = pull(ee, majority, w, h, ["cls"], (512, 64))[..., 0]
    log.info("land: class pulled")
    return land_image(np.nan_to_num(cls, nan=0), rest[..., 0], rest[..., 1], rest[..., 2], rest[..., 3])


def compute_relief(ee) -> np.ndarray:
    elev = ee.Image("NOAA/NGDC/ETOPO1").select("ice_surface").toFloat().rename("elev")
    lights = (ee.ImageCollection("NOAA/VIIRS/DNB/ANNUAL_V22").filterDate("2022-01-01", "2025-01-01")
              .select("average_masked").mean().rename("lights"))
    w, h = RELIEF_SIZE
    arr = pull(ee, ee.Image.cat(elev, lights.unmask(0)), w, h, ["elev", "lights"], (w, 256))
    return relief_image(arr[..., 0], arr[..., 1])


def compute_ocean(ee) -> list[np.ndarray]:
    hycom = ee.ImageCollection("HYCOM/sea_water_velocity").select(["velocity_u_0", "velocity_v_0"]).filter(ee.Filter.calendarRange(0, 0, "hour"))
    chl = ee.ImageCollection("NASA/OCEANDATA/MODIS-Aqua/L3SMI").filterDate("2015-01-01", "2025-01-01").select("chlor_a")
    w, h = OCEAN_SIZE
    frames = []
    for m in range(1, 13):
        cal = ee.Filter.calendarRange(m, m, "month")
        yearly = []
        for y in YEARS:
            month = hycom.filterDate(f"{y}-01-01", f"{y + 1}-01-01").filter(cal)
            if month.size().getInfo() == 0:
                log.info("HYCOM has no %d-%02d, skipped", y, m)
                continue
            yearly.append(pull(ee, month.mean().multiply(0.001), w, h, ["velocity_u_0", "velocity_v_0"], (w, 180)))
        uv = nanmean_stack(yearly)
        c = pull(ee, chl.filter(cal).mean(), w, h, ["chlor_a"], (w, 180))[..., 0]
        frames.append(ocean_frame(uv[..., 0], uv[..., 1], c))
        log.info("ocean month %d done (%d HYCOM years)", m, len(yearly))
    return frames
