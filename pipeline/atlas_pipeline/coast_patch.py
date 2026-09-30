"""Patch served Living Earth tiles with the coast mask, without pulling anything from Earth Engine again.

At the mask level (the tileset's finest detail level) a land tile's class byte (R) goes from water (8) to ocean (0)
where the mask says sea, and its tree byte (G) is zeroed there as land_rgb does for ocean; hillshade (B) and every
other tile kind (ndvi, rgb) are left alone. Coarser levels are re-derived the way write_shard builds them: the 2x2
mode (land beats ocean) of the level below, applied only where the old class was water, which is the only place
the mode can change when water becomes ocean.

Files are replaced one at a time (temp file in the same folder, then os.replace), never a folder rename, so a
running Vite dev server keeps serving them. The manifest is not touched: every tile stays where it was.
"""

import os
import shutil
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

from . import coast_mask as cm
from . import tile_math as tm
from .living_earth_v2 import WATER_CLASS
from .tile_product import tile_path
from .tile_raster import block_mode

PX = tm.TILE_PX
Tiles = cm.Tiles


def patch_fine(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """New land tile: water under a sea mask pixel becomes ocean (class 0, tree 0)."""
    sea = (rgb[..., 0] == WATER_CLASS) & cm.is_sea(mask)
    out = rgb.copy()
    out[..., 0] = np.where(sea, 0, rgb[..., 0])
    out[..., 1] = np.where(sea, 0, rgb[..., 1])
    return out


def derive_coarse(rgb: np.ndarray, below: np.ndarray) -> np.ndarray:
    """New coarse land tile from the (512, 512) classes of its four children, changing only its water pixels."""
    derived = block_mode(below, 2)
    cls = np.where(rgb[..., 0] == WATER_CLASS, derived, rgb[..., 0])
    out = rgb.copy()
    out[..., 0] = cls
    out[..., 1] = np.where(cls == 0, 0, rgb[..., 1])
    return out


def _read(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"))


def _replace(path: Path, rgb: np.ndarray, backup: Path | None, root: Path) -> None:
    if backup is not None:
        keep = backup / path.relative_to(root)
        if not keep.exists():  # the first original wins, so a second run never backs up patched tiles
            keep.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, keep)
    tmp = path.with_name(f".{path.name}.tmp")
    Image.fromarray(np.ascontiguousarray(rgb), "RGB").save(tmp, format="PNG", optimize=True)
    os.replace(tmp, path)


def _patch_one(job: tuple) -> tuple[tm.Tile, int]:
    """(tile, water pixels turned to ocean) for one fine tile; 0 when nothing changed or a file is missing."""
    root, coast, tile, backup = job
    path, mask = tile_path(root, "land", tile), cm.read_mask(coast, tile)
    if mask is None or not path.exists():
        return tile, 0
    old = _read(path)
    new = patch_fine(old, mask)
    changed = int((new[..., 0] != old[..., 0]).sum())
    if changed:
        _replace(path, new, backup, root)
    return tile, changed


def _classes(root: Path, tile: tm.Tile) -> np.ndarray:
    path = tile_path(root, "land", tile)
    return _read(path)[..., 0] if path.exists() else np.zeros((PX, PX), np.uint8)  # a missing tile is open sea


def _derive_one(job: tuple) -> tuple[tm.Tile, int]:
    root, tile, backup = job
    path = tile_path(root, "land", tile)
    if not path.exists():
        return tile, 0
    a, b, c, d = (_classes(root, t) for t in tm.children(tile))
    old = _read(path)
    new = derive_coarse(old, np.block([[a, b], [c, d]]))
    changed = int((new[..., 0] != old[..., 0]).sum())
    if changed:
        _replace(path, new, backup, root)
    return tile, changed


def patch_tileset(root: Path, coast: Path, level: int, min_level: int, bbox: tm.Bounds | None = None,
                  backup: Path | None = None, workers: int = 8, log=print) -> dict:
    """Patch `root` from the masks at `level` in `coast` (only those inside `bbox` when given), then re-derive the
    tiles above every changed one down to `min_level`. Returns pixels and tiles changed per level."""
    root, coast = Path(root), Path(coast)
    masks = sorted(cm.scan_masks(coast).get(level, set()))
    tiles = [(level, x, y) for x, y in masks]
    if bbox is not None:
        tiles = [t for t in tiles if overlaps(tm.bounds(t), bbox)]
    summary: dict[str, dict] = {}
    with ProcessPoolExecutor(max_workers=workers) as pool:
        done = [r for r in pool.map(_patch_one, [(root, coast, t, backup) for t in tiles], chunksize=16) if r[1]]
        summary[str(level)] = {"masks": len(tiles), "tiles": len(done), "pixels": sum(n for _, n in done)}
        log(f"level {level}: {summary[str(level)]}")
        changed = {t for t, _ in done}
        for z in range(level - 1, min_level - 1, -1):
            up = sorted({tm.parent(t) for t in changed})
            done = [r for r in pool.map(_derive_one, [(root, t, backup) for t in up], chunksize=16) if r[1]]
            summary[str(z)] = {"tiles": len(done), "pixels": sum(n for _, n in done)}
            log(f"level {z}: {summary[str(z)]}")
            changed = {t for t, _ in done}
    return summary


def overlaps(a: tm.Bounds, b: tm.Bounds) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def census(root: Path, level: int) -> tuple[Tiles, Tiles, Tiles]:
    """(present, water, ocean) land tiles at `level` under a tileset: all, those with class 8, those with class 0."""
    present, water, ocean = set(), set(), set()
    paths = sorted((Path(root) / "land" / str(level)).glob("*/*.png"))
    with ProcessPoolExecutor() as pool:
        for (x, y), has_water, has_ocean in pool.map(_census_one, paths, chunksize=64):
            present.add((x, y))
            if has_water:
                water.add((x, y))
            if has_ocean:
                ocean.add((x, y))
    return present, water, ocean



def _census_one(path: Path) -> tuple[tuple[int, int], bool, bool]:
    cls = _read(path)[..., 0]
    return (int(path.parent.name), int(path.stem)), bool((cls == WATER_CLASS).any()), bool((cls == 0).any())
