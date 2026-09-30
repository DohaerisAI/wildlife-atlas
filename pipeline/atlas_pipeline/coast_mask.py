"""Coast mask (L2 product): share of each tile pixel that Copernicus GLO-30's water body mask (WBM) calls ocean.

WorldCover labels near-shore sea as water and HYCOM's ~9 km cells miss that strip, so tiles built before the WBM
rule (commit 0e398d2) show pale water boxes along coasts. Instead of rebuilding the world, the mask is pulled once
for coastal tiles only and the served tiles are patched locally (coast_patch).

Layout: {root}/sea/{z}/{x}/{y}.png, one byte per pixel = round(255 * ocean share), plus manifest.json.
Coastal tiles: tiles at the mask level that hold WorldCover water and see ocean (class 0) in themselves or one of
their 8 neighbours (a missing neighbour is open sea). Inland lakes and rivers (the Caspian, the Great Lakes) are
never requested and stay water.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

from . import tile_math as tm

VERSION = 1
SEA_BYTE = 128  # ocean share >= 0.5: the rule land_class applies to the sea share
SOURCE = ("COPERNICUS/DEM/GLO30_2024_1 WBM == 1 (ocean; 2 lake and 3 river are not), mean of its 30 m pixels per tile "
          "pixel, 0 where GLO-30 has no data")
PLAN_PATH = Path(__file__).resolve().parents[1] / "assets" / "coast-plan.json"

Tiles = set[tuple[int, int]]


def share_byte(share: np.ndarray) -> np.ndarray:
    return np.clip(np.round(np.nan_to_num(np.asarray(share, dtype="float64"), nan=0.0) * 255), 0, 255).astype(np.uint8)


def is_sea(mask: np.ndarray) -> np.ndarray:
    return np.asarray(mask) >= SEA_BYTE


def coastal_tiles(z: int, present: Tiles, water: Tiles, ocean: Tiles) -> Tiles:
    """Tiles of `water` (holding WorldCover water) with ocean in themselves or a neighbour. `present` are the land
    tiles on disk (a tile not in it is open sea), `ocean` those holding class 0 pixels. x wraps at the antimeridian."""
    w, h = tm.cols(z), tm.rows(z)

    def sees_ocean(x: int, y: int) -> bool:
        near = (((x + dx) % w, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if 0 <= y + dy < h)
        return any(n not in present or n in ocean for n in near)

    return {t for t in water if sees_ocean(*t)}


def plan_payload(z: int, tiles: Tiles) -> dict:
    return {"level": z, "count": len(tiles), "index": tm.encode_index(z, tiles),
            "rule": "tiles with WorldCover water and ocean in themselves or a neighbour"}


def read_plan(path: Path = PLAN_PATH) -> tuple[int, Tiles]:
    p = json.loads(Path(path).read_text())
    tiles = tm.decode_index(p["level"], p["index"])
    if len(tiles) != p["count"]:
        raise ValueError(f"{path}: index holds {len(tiles)} tiles, count says {p['count']}")
    return p["level"], tiles


def plan_shards(z: int, tiles: Tiles, shard_level: int = 3) -> list[tm.Tile]:
    return sorted({tm.ancestor((z, x, y), shard_level) for x, y in tiles})


def mask_path(root: Path, tile: tm.Tile) -> Path:
    z, x, y = tile
    return Path(root) / "sea" / str(z) / str(x) / f"{y}.png"


def write_mask(root: Path, tile: tm.Tile, mask: np.ndarray) -> int:
    if mask.shape != (tm.TILE_PX, tm.TILE_PX) or mask.dtype != np.uint8:
        raise ValueError(f"mask for {tile} must be {tm.TILE_PX} x {tm.TILE_PX} uint8")
    path = mask_path(root, tile)
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(mask, "L").save(path, optimize=True)
    return path.stat().st_size


def read_mask(root: Path, tile: tm.Tile) -> np.ndarray | None:
    path = mask_path(root, tile)
    return np.asarray(Image.open(path).convert("L")) if path.exists() else None


def scan_masks(root: Path) -> dict[int, Tiles]:
    found: dict[int, Tiles] = {}
    for p in (Path(root) / "sea").glob("*/*/*.png"):
        found.setdefault(int(p.parent.parent.name), set()).add((int(p.parent.name), int(p.stem)))
    return found


def write_manifest(root: Path, requested: int) -> dict:
    """Manifest of the masks under root (written last, atomically)."""
    present = scan_masks(root)
    m = {
        "version": VERSION,
        "kind": "coast-mask",
        "built": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "scheme": "same EPSG:4326 quadtree and 256 px tiles as the Living Earth tilesets",
        "path": "sea/{z}/{x}/{y}.png",
        "encoding": f"byte b = round(255 * ocean share); sea where b >= {SEA_BYTE}",
        "source": SOURCE,
        "requested": requested,
        "index": {str(z): tm.encode_index(z, t) for z, t in sorted(present.items())},
        "counts": {str(z): len(t) for z, t in sorted(present.items())},
    }
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    tmp = root / ".manifest.json.tmp"
    tmp.write_text(json.dumps(m, indent=1))
    os.replace(tmp, root / "manifest.json")
    return m
