"""World tiles (levels 0-4) rebuilt from the detail tiles wherever those exist, without Earth Engine.

The world tileset was cut from pack v2 land.png (~10 km pixels, nearest-upsampled to level 4), so from space every
coast showed 10 km stairs even where 300 m detail tiles exist. Each world tile is now the 2x2 reduction of its four
children (class: mode, land beats ocean; tree and hillshade: mean), starting from detail level 5. A child the
detail set lacks keeps the old world tile's own quarter, so areas without detail look as before.
Files are replaced one at a time (never a folder rename, so a running Vite keeps serving); the manifest last.
"""

import os
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

from . import tile_math as tm
from .tile_product import manifest, scan, tile_path, write_manifest
from .tile_raster import block_mean, block_mode

PX = tm.TILE_PX
Tile = tm.Tile


def _read(path: Path) -> np.ndarray | None:
    return np.asarray(Image.open(path).convert("RGB")) if path.exists() else None


def reduce_children(kids: list[np.ndarray | None], old: np.ndarray | None) -> np.ndarray | None:
    """One tile from its four children (row-major, None = no data), falling back to `old`'s quarter per child."""
    if all(k is None for k in kids):
        return None
    quarters = []
    for i, k in enumerate(kids):
        if k is not None:
            cls = block_mode(k[..., 0], 2)
            tree = np.round(block_mean(k[..., 1].astype(float), 2))
            shade = np.round(block_mean(k[..., 2].astype(float), 2))
            q = np.stack([cls, np.where(cls == 0, 0, tree), shade], axis=-1).astype(np.uint8)
        elif old is not None:
            y, x = divmod(i, 2)
            q = old[y * PX // 2:(y + 1) * PX // 2, x * PX // 2:(x + 1) * PX // 2]
        else:
            q = np.zeros((PX // 2, PX // 2, 3), np.uint8)
        quarters.append(q)
    top, bottom = np.concatenate(quarters[:2], axis=1), np.concatenate(quarters[2:], axis=1)
    return np.ascontiguousarray(np.concatenate([top, bottom], axis=0))


def _replace(path: Path, rgb: np.ndarray, backup: Path | None, root: Path) -> None:
    if backup is not None and path.exists():
        keep = backup / path.relative_to(root)
        if not keep.exists():
            keep.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, keep)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    Image.fromarray(rgb, "RGB").save(tmp, format="PNG", optimize=True)
    os.replace(tmp, path)


def rebuild_world(world: Path, detail: Path, backup: Path | None = None, top: int = 4, log=print) -> dict[str, int]:
    """Rewrite world levels `top`..0 from detail level top+1. Returns tiles written per level."""
    world, detail = Path(world), Path(detail)
    have = {z: {(z, x, y) for x, y in tiles} for z, tiles in scan(detail).items()}
    fine = have.get(top + 1, set())
    # tiles at each level whose subtree holds detail, and the source of their children
    todo = {top: {tm.parent(t) for t in fine}}
    for z in range(top - 1, -1, -1):
        todo[z] = {tm.parent(t) for t in todo[z + 1]}
    counts = {}
    for z in range(top, -1, -1):
        src_root = detail if z == top else world
        written = 0
        for t in sorted(todo[z]):
            kids = [_read(tile_path(src_root, "land", c)) for c in tm.children(t)]
            if z == top:
                kids = [k if c in fine else None for k, c in zip(kids, tm.children(t))]
            old = _read(tile_path(world, "land", t))
            new = reduce_children(kids, old)
            if new is None or not new[..., 0].any():
                continue
            if old is None or not np.array_equal(new, old):
                _replace(tile_path(world, "land", t), new, backup, world)
                written += 1
        counts[str(z)] = written
        log(f"world level {z}: {written} of {len(todo[z])} tiles rewritten from level {z + 1}")
    m = manifest("world", (0, top), scan(world), ndvi=False)
    m["notes"] += "; levels 0-4 are reduced from detail level 5 where it exists, else cut from pack v2 land.png"
    write_manifest(world, m)
    return counts
