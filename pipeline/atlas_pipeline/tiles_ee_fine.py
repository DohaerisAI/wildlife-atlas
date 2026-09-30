"""Earth Engine sources for the town-scale levels (9-11, ~300-75 m pixels), decision 0010 quality bar.

- shade: hillshade computed on Copernicus GLO-30 at its own 30 m grid, then averaged into each tile pixel, so relief
  keeps its texture instead of being shaded from an already-averaged DEM.
- NDVI: Sentinel-2 L2A (harmonized), cloud and shadow masked with the scene classification, monthly median per
  calendar month over 2019-2024.
- rgb: our own cloud-free Sentinel-2 true-colour mosaic, median of 2022-2024 scenes, bands B4/B3/B2.
Sentinel-2 is read at the tile scale, so Earth Engine averages each scene's own pyramid (10 m -> tile pixel).
"""

import numpy as np

from . import tile_math as tm
from .living_earth_v2_ee import SENTINEL

FINE_FROM_LEVEL = 9
# Finest level with its own NDVI tiles. Sentinel-2 monthly medians at levels 10-11 run ~5 min per computePixels call
# until Earth Engine drops the connection; NDVI at 64 px per level-9 tile (~600 m) is what vegetation breathing needs,
# and the engine samples the level-9 tile's sub-rectangle for levels 10-11 (web/src/engine/tiles/tileset.ndviSource).
NDVI_MAX_LEVEL = 9
DEM = "COPERNICUS/DEM/GLO30_2024_1"  # GLO-30 release 2024_1 (ImageCollection, band DEM, 30 m, metres above EGM2008)
SHADE_EXAGGERATION = 1.5
S2 = "COPERNICUS/S2_SR_HARMONIZED"
S2_CLEAR_SCL = (4, 5, 6, 7, 11)  # vegetation, bare, water, unclassified, snow; not cloud, shadow or cirrus
RGB_REFLECTANCE_WHITE = 0.3  # surface reflectance that maps to byte 255 (before the display curve)
RGB_GAMMA = 1 / 2.2
SOURCES = {
    "shade": f"{DEM} DEM x {SHADE_EXAGGERATION}, ee.Terrain.hillshade at 30 m (azimuth 315, altitude 45), mean per tile pixel",
    "ndvi": f"{S2} (B8-B4)/(B8+B4), SCL-masked to clear land and water, median per calendar month 2022-2024, down to level {NDVI_MAX_LEVEL} (finer levels sample it; MODIS MOD13A2 where a piece times out)",
    "rgb": f"{S2} B4/B3/B2 median 2022-2024 (scenes under 40% cloud, SCL-masked), byte = 255*(reflectance/{RGB_REFLECTANCE_WHITE})^(1/2.2)",
    "rgb_license": "Contains modified Copernicus Sentinel data 2022-2024 (free, full and open; attribution required)",
}


def _proj(ee, level: int, px_per_tile: int = tm.TILE_PX):
    px = tm.span(level) / px_per_tile
    return ee.Projection("EPSG:4326").scale(px, px)


def shade_image(ee, level: int):
    glo = ee.ImageCollection(DEM).select("DEM")
    dem = glo.mosaic().setDefaultProjection(glo.first().projection())
    shade = ee.Terrain.hillshade(dem.multiply(SHADE_EXAGGERATION)).toFloat()
    return shade.reduceResolution(ee.Reducer.mean(), False, 4096).reproject(_proj(ee, level)).rename("shade")


def _clear(im):
    scl = im.select("SCL")
    ok = scl.eq(S2_CLEAR_SCL[0])
    for c in S2_CLEAR_SCL[1:]:
        ok = ok.Or(scl.eq(c))
    return im.updateMask(ok)


def s2_ndvi_image(ee, level: int):
    """12 bands m1..m12 on the NDVI grid (64 px per tile at `level`)."""
    col = (ee.ImageCollection(S2).filterDate("2022-01-01", "2025-01-01").filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 50))
           .map(_clear).map(lambda im: ee.Image(im.normalizedDifference(["B8", "B4"]).rename("ndvi").copyProperties(im, ["system:time_start"]))))
    proj = _proj(ee, level, 64)
    months = [col.filter(ee.Filter.calendarRange(m, m, "month")).median().reproject(proj).rename(f"m{m}") for m in range(1, 13)]
    return ee.Image.cat([m.unmask(SENTINEL).toFloat() for m in months])


def s2_rgb_image(ee, level: int):
    col = (ee.ImageCollection(S2).filterDate("2022-01-01", "2025-01-01").filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 40))
           .map(_clear).select(["B4", "B3", "B2"], ["r", "g", "b"]))
    return col.median().multiply(0.0001).reproject(_proj(ee, level)).unmask(SENTINEL).toFloat()


def rgb_bytes(reflectance: np.ndarray) -> np.ndarray:
    """(h, w, 3) surface reflectance (NaN = no clear scene) to display bytes; no data becomes 0."""
    r = np.asarray(reflectance, dtype=np.float64)
    v = np.clip(np.nan_to_num(r, nan=0.0) / RGB_REFLECTANCE_WHITE, 0, 1) ** RGB_GAMMA
    return np.round(v * 255).astype(np.uint8)
