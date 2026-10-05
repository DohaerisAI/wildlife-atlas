"""True-colour tiles worldwide (levels 0-8) from MODIS NBAR, so the land looks like the planet, not a class map.

Source: MODIS/061/MCD43A4 nadir BRDF-adjusted reflectance (500 m, daily, already cloud-cleared), bands 1/4/3 as
red/green/blue, mean of every 8th day of 2024 (46 days). A two-year daily median looked the same and cost ~22 s per
tile. Pulled at level 7 (~610 m, close to MODIS' own 463 m) under every detail land tile: pulling level 8 (~300 m)
cost 4x as much for MODIS pixels scaled up, ~33 tiles/min. Level 8 is the level-7 quarter upsampled bilinearly;
levels 6-5 and world 0-4 are 2x2 means of the level below, all computed locally. Bytes use the Sentinel-2 site encoding (tiles_ee_fine.rgb_bytes)
so both read the same in the shader. Tiles: rgb/{z}/{x}/{y}.jpg next to land/, manifest `rgb` added last.
"""

import json
import os
from pathlib import Path

import numpy as np
from PIL import Image

from . import tile_math as tm
from .living_earth_v2_ee import SENTINEL
from .tile_product import save_jpg, tile_path
from .tile_raster import block_mean

MODIS = "MODIS/061/MCD43A4"
BANDS = {"r": "Nadir_Reflectance_Band1", "g": "Nadir_Reflectance_Band4", "b": "Nadir_Reflectance_Band3"}
YEAR, EVERY_DAYS = 2024, 8
PULL_LEVEL = 7  # ~610 m pixels, about MODIS' own 463 m; level 8 is MODIS scaled up, so it is filled locally
SOURCE = (f"{MODIS} nadir BRDF-adjusted reflectance, bands 1/4/3, mean of every {EVERY_DAYS}th day of {YEAR}, "
          "byte = 255*(reflectance/0.3)^(1/2.2); coarser levels are 2x2 means")
LICENSE = "MODIS data courtesy of NASA LP DAAC (public domain; attribution requested)"
PX = tm.TILE_PX


def modis_rgb_image(ee, level: int):
    days = ee.List.sequence(0, 365, EVERY_DAYS)
    start = ee.Date(f"{YEAR}-01-01")
    col = ee.ImageCollection(MODIS)
    picks = days.map(lambda d: col.filterDate(start.advance(d, "day"), start.advance(ee.Number(d).add(1), "day")).first())
    frames = ee.ImageCollection.fromImages(picks.removeAll([None])).select(list(BANDS.values()), list(BANDS))
    native = col.first().projection()  # a composite loses it; without this Earth Engine averages at 1 degree
    px = tm.span(level) / PX
    return (frames.mean().setDefaultProjection(native).multiply(0.0001).resample("bilinear")
            .reproject(ee.Projection("EPSG:4326").scale(px, px)).unmask(SENTINEL).toFloat())


def reduce_rgb(kids: list[np.ndarray | None]) -> np.ndarray | None:
    """One tile from its four children (row-major, None = none): 2x2 mean per channel; a missing child stays black."""
    if all(k is None for k in kids):
        return None
    quarters = [np.zeros((PX // 2, PX // 2, 3), np.uint8) if k is None else
                np.stack([np.round(block_mean(k[..., c].astype(float), 2)) for c in range(3)], -1).astype(np.uint8)
                for k in kids]
    return np.concatenate([np.concatenate(quarters[:2], 1), np.concatenate(quarters[2:], 1)], 0)


def _read(path: Path) -> np.ndarray | None:
    return np.asarray(Image.open(path).convert("RGB")) if path.exists() else None


def derive_levels(root: Path, top: int, bottom: int, changed: set[tm.Tile], log=print) -> set[tm.Tile]:
    """Write rgb for the parents of `changed` from level top-1 down to `bottom`; returns the tiles written at `bottom`."""
    for z in range(top - 1, bottom - 1, -1):
        parents = sorted({tm.parent(t) for t in changed})
        changed = set()
        for t in parents:
            new = reduce_rgb([_read(tile_path(root, "rgb", c)) for c in tm.children(t)])
            if new is not None:
                save_jpg(new, tile_path(root, "rgb", t))
                changed.add(t)
        log(f"rgb level {z}: {len(changed)} tiles")
    return changed


def copy_into_world(detail: Path, world: Path, top: int = 4, log=print) -> int:
    """World levels 0..top from detail level top+1 rgb (the detail set starts at level 5)."""
    fine = {(top + 1, int(p.parent.name), int(p.stem)) for p in (detail / "rgb" / str(top + 1)).glob("*/*.jpg")}
    level_parents = sorted({tm.parent(t) for t in fine})
    for t in level_parents:
        new = reduce_rgb([_read(tile_path(detail, "rgb", c)) for c in tm.children(t)])
        if new is not None:
            save_jpg(new, tile_path(world, "rgb", t))
    log(f"world rgb level {top}: {len(level_parents)} tiles")
    derive_levels(world, top, 0, set(level_parents), log)
    return len(level_parents)


def add_to_manifest(root: Path) -> None:
    """Declare the rgb tiles in the tileset manifest (atomic replace, so a running page never reads half of it)."""
    path = Path(root) / "manifest.json"
    m = json.loads(path.read_text())
    m["rgb"] = {"path": "rgb/{z}/{x}/{y}.jpg", "format": "jpeg", "source": SOURCE, "license": LICENSE}
    tmp = path.with_name(".manifest.json.tmp")
    tmp.write_text(json.dumps(m, indent=1, ensure_ascii=False))
    os.replace(tmp, path)


def upsample_quarter(parent: np.ndarray, quarter: int) -> np.ndarray:
    """A child tile's rgb from its parent's quarter (row-major index), bilinear 2x."""
    y, x = divmod(quarter, 2)
    q = parent[y * PX // 2:(y + 1) * PX // 2, x * PX // 2:(x + 1) * PX // 2]
    return np.asarray(Image.fromarray(np.ascontiguousarray(q)).resize((PX, PX), Image.BILINEAR))


def pull_and_derive(ee, detail: Path, world: Path, workers: int, groups: int, keep=None, log=print) -> None:
    """Level-7 rgb under every detail land tile without one (or only those `keep` accepts), then level 8 by
    upsampling, levels 6-5 and world 0-4 by 2x2 means."""
    from .ee_groups import run_groups
    from .tile_product import scan
    from .tiles_ee import _pull_tiles
    from .tiles_ee_fine import rgb_bytes

    fine, pull_z = 8, PULL_LEVEL
    land8 = sorted((fine, x, y) for x, y in scan(detail).get(fine, set()) if keep is None or keep((fine, x, y)))
    need = sorted({tm.ancestor(t, pull_z) for t in land8})
    have = {(pull_z, int(p.parent.name), int(p.stem)) for p in (detail / "rgb" / str(pull_z)).glob("*/*.jpg")}
    todo = [t for t in need if t not in have]
    log("rgb: %d level-%d tiles to pull (%d of %d already on disk)", len(todo), pull_z, len(need) - len(todo), len(need))
    image = modis_rgb_image(ee, pull_z)

    def pull(tiles: list) -> int:
        got = _pull_tiles(ee, image, ["r", "g", "b"], tiles, pull_z, workers, "rgb", None, pull_z - 1)
        for t, a in got.items():
            save_jpg(rgb_bytes(a), tile_path(detail, "rgb", t))
        return len(got)

    run_groups(todo, pull, groups, log, "rgb")
    written = 0
    for t in land8:
        parent = _read(tile_path(detail, "rgb", tm.parent(t)))
        if parent is not None:
            save_jpg(upsample_quarter(parent, tm.children(tm.parent(t)).index(t)), tile_path(detail, "rgb", t))
            written += 1
    log("rgb level 8: %d tiles upsampled from level 7", written)
    pulled = {t for t in need if tile_path(detail, "rgb", t).exists()}
    derive_levels(detail, pull_z, 5, pulled, lambda m: log("%s", m))
    copy_into_world(detail, world, log=lambda m: log("%s", m))
    add_to_manifest(detail)
    add_to_manifest(world)
    log("rgb: done")
