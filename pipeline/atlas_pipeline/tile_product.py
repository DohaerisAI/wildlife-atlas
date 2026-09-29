"""Living Earth tile pyramids (L2 product, decision 0010): write tiles from mosaics, cut the world pack, manifest.

Two tilesets, each a folder with its own manifest.json (the engine refuses a tileset without one):
- world:  levels 0-4, cut from pack v2 land.png (~10 km pixels), every land-bearing tile.
- detail: levels 5..L (L up to 8, ~300 m pixels), computed in Earth Engine per level-3 shard, land-bearing tiles only.
Layout inside a tileset: land/{z}/{x}/{y}.png (RGB class, tree, hillshade) and, for detail, ndvi/{z}/{x}/{y}.png.
"""

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

from . import tile_math as tm
from .living_earth import to_byte
from .living_earth_v2 import ATTRIBUTION, LAND, LAND_CLASSES
from .tile_raster import (NDVI, NDVI_PX, block_mean, block_mode, exaggeration, hillshade, land_rgb, ndvi_atlas,
                          resample_bilinear, resample_nearest)

VERSION = 1
PX = tm.TILE_PX
SCHEME = ("EPSG:4326 quadtree: level z has 2^(z+1) x 2^z tiles of 180/2^z degrees and 256 px; "
          "x counts east from 180W, y counts south from 90N")
PMTILES_NOTE = "PMTiles: store level z at PMTiles zoom z+1 (its 2^(z+1) square grid holds our 2^(z+1) x 2^z tiles)"


@dataclass(frozen=True)
class Mosaic:
    """One shard's pixels at its finest level. Arrays are north-up over the shard tile.
    cls: class index (uint8), tree: % canopy, elev: metres, ndvi: (12, m, m) with m = 64 per finest tile."""
    shard: tm.Tile
    level: int
    cls: np.ndarray
    tree: np.ndarray
    elev: np.ndarray
    ndvi: np.ndarray | None
    shade: np.ndarray | None = None  # hillshade bytes (0..255) averaged from the DEM's own grid (town levels)
    rgb: np.ndarray | None = None  # (n, n, 3) Sentinel-2 true colour bytes, 0 = no clear scene (town levels)

    def __post_init__(self):
        n = PX * 2 ** (self.level - self.shard[0])
        if self.cls.shape != (n, n) or self.tree.shape != (n, n) or self.elev.shape != (n, n):
            raise ValueError(f"mosaic arrays must be {n} x {n}")
        if self.ndvi is not None and self.ndvi.shape != (12, n // 4, n // 4):
            raise ValueError(f"ndvi must be (12, {n // 4}, {n // 4})")
        if self.shade is not None and self.shade.shape != (n, n):
            raise ValueError(f"shade must be {n} x {n}")
        if self.rgb is not None and self.rgb.shape != (n, n, 3):
            raise ValueError(f"rgb must be {n} x {n} x 3")


def save_jpg(arr: np.ndarray, path: Path, quality: int = 85) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr, "RGB").save(path, quality=quality, optimize=True)
    return path.stat().st_size


def save_png(arr: np.ndarray, path: Path) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr, "RGB" if arr.ndim == 3 else "L").save(path, optimize=True)
    return path.stat().st_size


def tile_path(root: Path, kind: str, tile: tm.Tile) -> Path:
    z, x, y = tile
    return root / kind / str(z) / str(x) / f"{y}.{'jpg' if kind == 'rgb' else 'png'}"


def _cut(a: np.ndarray, i: int, j: int, size: int) -> np.ndarray:
    return a[j * size:(j + 1) * size, i * size:(i + 1) * size]


def write_level(root: Path, shard: tm.Tile, level: int, cls, tree, elev, ndvi, shade=None, truecolor=None) -> list[tuple[tm.Tile, int]]:
    """Write every land-bearing tile of `shard` at `level` from shard-wide arrays at that level. Hillshade comes from
    `shade` (averaged from the DEM's own grid) when given, else it is computed from the averaged `elev`."""
    north = tm.bounds(shard)[3]
    if shade is None:
        shade = hillshade(elev, tm.pixel_deg(level), north, exaggeration(level))
    else:
        shade = np.clip(np.round(np.nan_to_num(shade, nan=181.0)), 0, 255).astype(np.uint8)
    rgb = land_rgb(cls, to_byte(np.nan_to_num(tree, nan=0.0), LAND[1]), shade)
    n = 2 ** (level - shard[0])
    ndvi_px = ndvi.shape[1] // n if ndvi is not None else 0
    written = []
    for i in range(n):
        for j in range(n):
            tile = (level, shard[1] * n + i, shard[2] * n + j)
            land = _cut(rgb, i, j, PX)
            if not land[..., 0].any():
                continue
            size = save_png(np.ascontiguousarray(land), tile_path(root, "land", tile))
            if ndvi is not None:
                months = ndvi[:, j * ndvi_px:(j + 1) * ndvi_px, i * ndvi_px:(i + 1) * ndvi_px]
                if ndvi_px != NDVI_PX:
                    months = np.stack([resample_bilinear(m, NDVI_PX, NDVI_PX) for m in months])
                size += save_png(ndvi_atlas(months), tile_path(root, "ndvi", tile))
            if truecolor is not None:
                size += save_jpg(np.ascontiguousarray(_cut(truecolor, i, j, PX)), tile_path(root, "rgb", tile))
            written.append((tile, size))
    return written


def write_shard(root: Path, mosaic: Mosaic, min_level: int) -> list[tuple[tm.Tile, int]]:
    """Write the shard's pyramid from its finest level up to `min_level`, halving each step."""
    if not mosaic.shard[0] <= min_level <= mosaic.level:
        raise ValueError("min_level must lie between the shard level and the mosaic level")
    cls, tree, elev, ndvi, shade, rgb = mosaic.cls, mosaic.tree, mosaic.elev, mosaic.ndvi, mosaic.shade, mosaic.rgb
    written = []
    for level in range(mosaic.level, min_level - 1, -1):
        if level < mosaic.level:
            cls, tree, elev = block_mode(cls, 2), block_mean(tree, 2), block_mean(elev, 2)
            shade = block_mean(shade, 2) if shade is not None else None
            rgb = np.stack([np.round(block_mean(rgb[..., c].astype(float), 2)) for c in range(3)], axis=-1).astype(np.uint8) if rgb is not None else None
            if ndvi is not None and ndvi.shape[1] // 2 ** (level - mosaic.shard[0]) > NDVI_PX:
                ndvi = np.stack([block_mean(m, 2) for m in ndvi])
        written += write_level(root, mosaic.shard, level, cls, tree, elev, ndvi, shade, rgb)
    return written


def world_level(land: np.ndarray, z: int) -> np.ndarray:
    """Pack v2 land.png (RGB class, tree, hillshade) at the pixel grid of level z (256 * 2^z rows)."""
    h, w = PX * tm.rows(z), PX * tm.cols(z)
    src_h, src_w = land.shape[:2]
    if (h, w) == (src_h, src_w):
        return land.copy()
    if h < src_h:
        f = src_h // h
        cls = block_mode(land[..., 0], f)
        rest = [np.round(block_mean(land[..., c].astype(float), f)).astype(np.uint8) for c in (1, 2)]
        return np.stack([cls, *rest], axis=-1)
    cls = resample_nearest(land[..., 0], h, w)
    rest = [np.clip(np.round(resample_bilinear(land[..., c], h, w)), 0, 255).astype(np.uint8) for c in (1, 2)]
    return np.stack([cls, *rest], axis=-1)


def write_world(root: Path, land: np.ndarray, levels: range) -> list[tuple[tm.Tile, int]]:
    written = []
    for z in levels:
        img = world_level(land, z)
        for y in range(tm.rows(z)):
            for x in range(tm.cols(z)):
                tile = img[y * PX:(y + 1) * PX, x * PX:(x + 1) * PX]
                if tile[..., 0].any():
                    written.append(((z, x, y), save_png(np.ascontiguousarray(tile), tile_path(root, "land", (z, x, y)))))
    return written


def scan(root: Path) -> dict[int, set[tuple[int, int]]]:
    """Land tiles present under root/land/{z}/{x}/{y}.png, by level."""
    found: dict[int, set[tuple[int, int]]] = {}
    for p in (root / "land").glob("*/*/*.png"):
        z, x, y = int(p.parent.parent.name), int(p.parent.name), int(p.stem)
        found.setdefault(z, set()).add((x, y))
    return found


DETAIL_SOURCES = {
    "class": "ESA/WorldCover/v200 Map, mode of the 10 m pixels in each tile pixel at the finest level, then 2x2 mode "
             "(land wins over ocean) per coarser level; sea = WorldCover no-data, or water HYCOM treats as ocean",
    "tree": "MODIS/061/MOD44B Percent_Tree_Cover, 2020-2024 mean, averaged per tile pixel",
    "hillshade": "COPERNICUS/DEM/GLO30 (NOAA/NGDC/ETOPO1 where missing), mean per tile pixel, hillshade computed per level "
                 "(azimuth 315, altitude 45) with exaggeration 8*sqrt(pixel km/10) clamped 1.5..8",
}


def manifest(name: str, levels: tuple[int, int], present: dict[int, set[tuple[int, int]]], ndvi: bool,
             sources: dict[str, str] | None = None, bounds: tm.Bounds = (-180.0, -90.0, 180.0, 90.0), rgb: dict | None = None) -> dict:
    channels = []
    for c in LAND:
        extra = {"encoding": "byte is the class index"} if c.name == "class" else (
            {"encoding": "byte is the brightness, 181 = flat"} if c.name == "hillshade" else {"encoding": "byte b = lo + b/255*(hi-lo)"})
        channels.append({"name": c.name, "lo": c.lo, "hi": c.hi, "unit": c.unit, "source": (sources or {}).get(c.name, c.source), **extra})
    lo, hi = levels
    return {
        "version": VERSION,
        "kind": "living-earth-tiles",
        "name": name,
        "built": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "scheme": SCHEME,
        "tileSize": PX,
        "levels": [lo, hi],
        "bounds": list(bounds),
        "land": {"path": "land/{z}/{x}/{y}.png", "channels": channels},
        "ndvi": {"path": "ndvi/{z}/{x}/{y}.png", "layout": {"cols": 4, "rows": 3, "frame": [NDVI_PX, NDVI_PX], "order": "Jan..Dec row-major"},
                 "channel": {"name": NDVI.name, "lo": NDVI.lo, "hi": NDVI.hi, "unit": NDVI.unit,
                             "source": (sources or {}).get("ndvi", "MODIS/061/MOD13A2 NDVI, 2015-2024 mean per calendar month"),
                             "encoding": "0 = no data; b in 1..255 decodes as lo + (b-1)/254*(hi-lo)"}} if ndvi else None,
        "rgb": ({"path": "rgb/{z}/{x}/{y}.jpg", "format": "jpeg", **rgb} if rgb else None),
        "index": {str(z): tm.encode_index(z, present.get(z, set())) for z in range(lo, hi + 1)},
        "counts": {str(z): len(present.get(z, set())) for z in range(lo, hi + 1)},
        "classes": [{"index": i, "name": n, "label": label, "worldcover": code} for i, n, label, code in LAND_CLASSES],
        "attribution": ATTRIBUTION,
        "notes": PMTILES_NOTE,
    }


def write_manifest(root: Path, m: dict) -> Path:
    path = root / "manifest.json"
    root.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(m, indent=1, ensure_ascii=False))
    return path
