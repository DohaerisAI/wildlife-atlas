"""Living Earth globe pack v2: v1's monthly surface and climate plus ocean, land and relief layers.

surface.png  4 x 3 months, each 1024 x 512, RGB = water share, snow, NDVI (as v1)
climate.png  4 x 3 months, each 360 x 180, RGB = wind u, wind v, temperature (as v1)
ocean.png    4 x 3 months, each 720 x 360, RGB = current u, current v, log10 chlorophyll-a (0 = no data)
land.png     4096 x 2048, RGB = land class index, tree cover %, hillshade
relief.png   2048 x 1024, RG = elevation as 16-bit (m + 11000, R high byte), B = night lights (log)
manifest.json  version 2: every layer's file, size, channels (name, lo, hi, unit, source), classes, attribution

Contract: docs/plans/atlas-v2.md. Earth Engine calls live in living_earth_v2_ee.py; this module is pure.
"""

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

from .living_earth import CLIMATE, COLS, MONTHS, ROWS, SURFACE, Channel, pack_atlas, to_byte

VERSION = 2
OCEAN_SIZE = (720, 360)
LAND_SIZE = (4096, 2048)
RELIEF_SIZE = (2048, 1024)
ELEVATION_OFFSET = 11000  # metres added before 16-bit encoding, so the Mariana Trench stays positive
NODATA = 0  # ocean.png byte meaning "no data here" (land, sea ice, cloud-covered all month)
HILLSHADE_EXAGGERATION = 8  # vertical exaggeration so relief reads at ~10 km pixels

# (index, name, label, ESA WorldCover v200 code)
LAND_CLASSES = (
    (0, "none", "Ocean or no data", None),
    (1, "tree", "Tree cover", 10),
    (2, "shrub", "Shrubland", 20),
    (3, "grass", "Grassland", 30),
    (4, "crop", "Cropland", 40),
    (5, "built", "Built-up", 50),
    (6, "bare", "Bare / sparse vegetation", 60),
    (7, "snow", "Snow and ice", 70),
    (8, "water", "Permanent water bodies", 80),
    (9, "wetland", "Herbaceous wetland", 90),
    (10, "mangrove", "Mangroves", 95),
    (11, "moss", "Moss and lichen", 100),
)
WATER_CLASS = 8
SNOW_CLASS = 7
ICE_SHEET_MIN_M = 10  # ETOPO1 ice_surface - bedrock, cell mean

OCEAN = (
    Channel("current_u", -1.5, 1.5, "m/s (towards east), surface",
            "HYCOM/sea_water_velocity velocity_u_0 x 0.001, daily 00 UTC fields, 2015-2024 (to 2024-09) monthly mean"),
    Channel("current_v", -1.5, 1.5, "m/s (towards north), surface",
            "HYCOM/sea_water_velocity velocity_v_0 x 0.001, daily 00 UTC fields, 2015-2024 (to 2024-09) monthly mean"),
    Channel("chlorophyll", -2.0, 1.5, "log10 mg/m³ chlorophyll-a",
            "NASA/OCEANDATA/MODIS-Aqua/L3SMI chlor_a, 2015-2024 monthly mean, then log10"),
)
LAND = (
    Channel("class", 0, 255, "class index (see classes); byte = index",
            "ESA/WorldCover/v200 Map, majority of ~1 km mode cells per pixel; sea = WorldCover no-data or water that HYCOM treats as ocean; "
            "beyond WorldCover (south of 60S, north of 82.75N) snow/ice where NOAA/NGDC/ETOPO1 ice_surface - bedrock >= 10 m, else 0"),
    Channel("tree", 0, 100, "% of the cell's land under tree canopy",
            "MODIS/061/MOD44B Percent_Tree_Cover, 2020-2024 mean; 0 over ocean"),
    Channel("hillshade", 0, 255, "shaded relief brightness, 181 = flat (sun azimuth 315°, altitude 45°)",
            f"NOAA/NGDC/ETOPO1 ice_surface, ee.Terrain.hillshade at the 4096 grid, {HILLSHADE_EXAGGERATION}x vertical exaggeration; sea floor included"),
)
RELIEF = (
    Channel("elevation", -ELEVATION_OFFSET, 65535 - ELEVATION_OFFSET, "m above sea level (sea floor negative, top of ice sheets)",
            "NOAA/NGDC/ETOPO1 ice_surface, cell mean"),
    Channel("lights", 0.0, 2.5, "log10(1 + nW/cm²/sr)",
            "NOAA/VIIRS/DNB/ANNUAL_V22 average_masked (background and fires removed), 2022-2024 mean"),
)

ATTRIBUTION = ("EC JRC/Google (Global Surface Water); NASA LP DAAC / NSIDC (MODIS); Copernicus Climate Change Service (ERA5); "
               "ESA WorldCover 2021 (CC BY 4.0, © ESA WorldCover project / Copernicus Sentinel data processed by ESA WorldCover consortium); "
               "HYCOM consortium (GOFS 3.1); NASA OB.DAAC (MODIS-Aqua ocean colour); NOAA NCEI (ETOPO1); "
               "Earth Observation Group, Payne Institute, Colorado School of Mines (VIIRS nighttime lights).")


# ---------- encodings ----------

def worldcover_to_class(codes: np.ndarray) -> np.ndarray:
    """ESA WorldCover codes (10, 20, ... 100) to the pack's class index; anything unknown is 0."""
    lut = np.zeros(256, dtype="uint8")
    for index, _, _, code in LAND_CLASSES:
        if code is not None:
            lut[code] = index
    c = np.nan_to_num(np.asarray(codes, dtype="float64"), nan=0)
    return lut[np.clip(np.round(c), 0, 255).astype("int64")]


def land_class(codes: np.ndarray, land_share: np.ndarray, sea_share: np.ndarray, ice_m: np.ndarray | None = None) -> np.ndarray:
    """Class index per cell. Cells WorldCover mostly doesn't map are 0 (ocean); so is 'water' that HYCOM models as sea
    (WorldCover labels the sea inside its coastal tiles as water; lakes like the Caspian and Superior stay water).
    WorldCover stops at 60S and 82.75N: there, cells ETOPO1 puts under an ice sheet or shelf (ice_m thick) are snow/ice."""
    cls = worldcover_to_class(codes)
    unmapped = np.nan_to_num(land_share) < 0.5
    ocean = unmapped | ((cls == WATER_CLASS) & (np.nan_to_num(sea_share) >= 0.5))
    out = np.where(ocean, 0, cls)
    if ice_m is not None:
        out = np.where(unmapped & (np.nan_to_num(ice_m) >= ICE_SHEET_MIN_M), SNOW_CLASS, out)
    return out.astype("uint8")


def encode_elevation(metres: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Metres to (high byte, low byte) of round(m + 11000), clipped to 0..65535. NaN encodes as sea level."""
    v = np.clip(np.round(np.nan_to_num(np.asarray(metres, dtype="float64"), nan=0) + ELEVATION_OFFSET), 0, 65535).astype("uint16")
    return (v >> 8).astype("uint8"), (v & 0xFF).astype("uint8")


def decode_elevation(hi: np.ndarray, lo: np.ndarray) -> np.ndarray:
    return hi.astype("float64") * 256 + lo.astype("float64") - ELEVATION_OFFSET


def to_byte_flagged(values: np.ndarray, ch: Channel) -> np.ndarray:
    """Scale lo..hi to 1..255; NaN (no data) becomes 0 so it can't be mistaken for a real value."""
    v = np.asarray(values, dtype="float64")
    scaled = np.clip(np.round(1 + (np.nan_to_num(v, nan=ch.lo) - ch.lo) / (ch.hi - ch.lo) * 254), 1, 255)
    return np.where(np.isnan(v), NODATA, scaled).astype("uint8")


def from_byte_flagged(b: np.ndarray, ch: Channel) -> np.ndarray:
    v = ch.lo + (b.astype("float64") - 1) / 254 * (ch.hi - ch.lo)
    return np.where(b == NODATA, np.nan, v)


def log_lights(radiance: np.ndarray) -> np.ndarray:
    return np.log10(1 + np.clip(np.nan_to_num(np.asarray(radiance, dtype="float64"), nan=0), 0, None))


def log_chlorophyll(chl: np.ndarray) -> np.ndarray:
    """log10 mg/m³; non-positive or missing values are no data (NaN)."""
    c = np.asarray(chl, dtype="float64")
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(c > 0, np.log10(np.where(c > 0, c, 1)), np.nan)


# ---------- tiling: computePixels has response limits, so big grids are pulled in pieces and stitched ----------

def tiles(width: int, height: int, tile_w: int, tile_h: int) -> list[tuple[int, int, int, int]]:
    """(x, y, w, h) pieces covering a width x height grid, row-major, edge pieces trimmed."""
    if min(width, height, tile_w, tile_h) <= 0:
        raise ValueError("sizes must be positive")
    return [(x, y, min(tile_w, width - x), min(tile_h, height - y)) for y in range(0, height, tile_h) for x in range(0, width, tile_w)]


def split_tile(tile: tuple[int, int, int, int]) -> list[tuple[int, int, int, int]]:
    """Halve a piece along its longer side (used when Earth Engine says a request is too big)."""
    x, y, w, h = tile
    if w * h <= 1:
        raise ValueError("cannot split a single pixel")
    if w >= h:
        half = w // 2
        return [(x, y, half, h), (x + half, y, w - half, h)]
    half = h // 2
    return [(x, y, w, half), (x, y + half, w, h - half)]


def stitch(pieces: list[tuple[tuple[int, int, int, int], np.ndarray]], width: int, height: int) -> np.ndarray:
    """Assemble (tile, array) pieces into one (height, width, bands) array; every pixel must be covered exactly once."""
    if not pieces:
        raise ValueError("no pieces to stitch")
    bands = pieces[0][1].shape[2]
    out = np.full((height, width, bands), np.nan)
    hits = np.zeros((height, width), dtype="int64")
    for (x, y, w, h), arr in pieces:
        if arr.shape != (h, w, bands):
            raise ValueError(f"piece at {(x, y)} has shape {arr.shape}, expected {(h, w, bands)}")
        out[y:y + h, x:x + w] = arr
        hits[y:y + h, x:x + w] += 1
    if not np.all(hits == 1):
        raise ValueError(f"pieces cover {int((hits == 0).sum())} pixels zero times and {int((hits > 1).sum())} more than once")
    return out


def tile_grid(width: int, height: int, tile: tuple[int, int, int, int]) -> dict:
    """computePixels grid for one piece of a global equirectangular width x height grid (180W, 90N at top left)."""
    x, y, w, h = tile
    dx, dy = 360 / width, 180 / height
    return {"dimensions": {"width": w, "height": h}, "crsCode": "EPSG:4326",
            "affineTransform": {"scaleX": dx, "shearX": 0, "translateX": -180 + x * dx, "shearY": 0, "scaleY": -dy, "translateY": 90 - y * dy}}


def nanmean_stack(arrays: list[np.ndarray]) -> np.ndarray:
    """Mean over the list ignoring NaN; all-NaN cells stay NaN (no warning)."""
    stack = np.stack(arrays)
    count = (~np.isnan(stack)).sum(axis=0)
    total = np.nansum(stack, axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(count > 0, total / np.maximum(count, 1), np.nan)


# ---------- layer assembly ----------

def ocean_frame(u: np.ndarray, v: np.ndarray, chl: np.ndarray) -> np.ndarray:
    """One month of ocean.png from current u, v (m/s, NaN on land) and chlorophyll (mg/m³, NaN where missing)."""
    return np.stack([to_byte_flagged(u, OCEAN[0]), to_byte_flagged(v, OCEAN[1]), to_byte_flagged(log_chlorophyll(chl), OCEAN[2])], axis=-1)


def land_image(codes, land_share, sea_share, tree, hillshade, ice_m=None) -> np.ndarray:
    cls = land_class(codes, land_share, sea_share, ice_m)
    tree_b = np.where(cls == 0, 0, to_byte(np.nan_to_num(tree, nan=0), LAND[1]))
    shade = np.clip(np.round(np.nan_to_num(hillshade, nan=181)), 0, 255).astype("uint8")
    return np.stack([cls, tree_b.astype("uint8"), shade], axis=-1)


def relief_image(elevation, radiance) -> np.ndarray:
    hi, lo = encode_elevation(elevation)
    return np.stack([hi, lo, to_byte(log_lights(radiance), RELIEF[1])], axis=-1)


# ---------- writing ----------

def _channels(chs, **extra) -> list[dict]:
    return [{**asdict(c), **extra.get(c.name, {})} for c in chs]


def manifest_v2(surface_month, climate_month, ocean_month, land_size, relief_size) -> dict:
    atlas = {"frames": MONTHS}
    return {
        "version": VERSION,
        "built": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "layout": {"cols": COLS, "rows": ROWS, "order": "Jan..Dec row-major", "projection": "equirectangular, north up, 180W at left"},
        "encoding": "byte b decodes as lo + b/255*(hi-lo) unless a channel says otherwise",
        "surface": {"file": "surface.png", **atlas, "month": list(surface_month), "channels": _channels(SURFACE)},
        "climate": {"file": "climate.png", **atlas, "month": list(climate_month), "channels": _channels(CLIMATE)},
        "ocean": {"file": "ocean.png", **atlas, "month": list(ocean_month),
                  "nodata": {"value": NODATA, "meaning": "no data: land, or no valid ocean value that month (sea ice, persistent cloud, coast)"},
                  "channels": _channels(OCEAN, **{c.name: {"encoding": "0 = no data; b in 1..255 decodes as lo + (b-1)/254*(hi-lo)"} for c in OCEAN})},
        "land": {"file": "land.png", "frames": 1, "size": list(land_size),
                 "channels": _channels(LAND, **{"class": {"encoding": "byte is the class index"},
                                                "hillshade": {"encoding": "byte is the brightness"}})},
        "relief": {"file": "relief.png", "frames": 1, "size": list(relief_size),
                   "channels": _channels(RELIEF, elevation={"bytes": ["R", "G"], "encoding": f"metres = R*256 + G - {ELEVATION_OFFSET}"},
                                         lights={"bytes": ["B"], "encoding": "log10(1+radiance) = b/255*2.5; 0 over open ocean"})},
        "classes": [{"index": i, "name": n, "label": label, "worldcover": code} for i, n, label, code in LAND_CLASSES],
        "attribution": ATTRIBUTION,
    }


def _save(arr: np.ndarray, path: Path) -> None:
    Image.fromarray(arr, "RGB").save(path, optimize=True)


def write_pack_v2(out_dir: Path, surface: list, climate: list, ocean: list, land: np.ndarray, relief: np.ndarray) -> dict:
    if land.shape[2] != 3 or relief.shape[2] != 3:
        raise ValueError("land and relief must be RGB")
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, months in (("surface", surface), ("climate", climate), ("ocean", ocean)):
        _save(pack_atlas(months), out_dir / f"{name}.png")
    _save(land, out_dir / "land.png")
    _save(relief, out_dir / "relief.png")
    manifest = manifest_v2(surface[0].shape[1::-1], climate[0].shape[1::-1], ocean[0].shape[1::-1], land.shape[1::-1], relief.shape[1::-1])
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    return manifest
