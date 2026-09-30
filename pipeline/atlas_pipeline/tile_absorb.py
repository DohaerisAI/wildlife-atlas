"""Ship tiles incrementally (owner direction): merge each finished shard into a served tileset right away.

A shard artifact holds land/ ndvi/ rgb/ tiles plus shard-z-x-y.json. Absorbing it removes that shard's old tiles
(only inside the shard, only at the levels it brings), copies the new ones in place (files inside existing folders,
never a folder rename: the Vite dev server keeps serving them), records the shard under shards/, and rewrites the
manifest last (atomically) with the availability index and the list of regions and their levels.
"""

import json
import os
import shutil
from pathlib import Path

from . import tile_math as tm
from .tile_product import manifest, ndvi_levels, scan, write_manifest

KINDS = ("land", "ndvi", "rgb")


def shard_summary(shard_dir: Path) -> dict:
    found = sorted(shard_dir.glob("shard-*.json"))
    if len(found) != 1:
        raise ValueError(f"{shard_dir} must hold exactly one shard-*.json, found {len(found)}")
    return json.loads(found[0].read_text())


def _tiles(root: Path) -> list[tuple[str, tm.Tile, Path]]:
    out = []
    for kind in KINDS:
        for p in (root / kind).glob("*/*/*.*"):
            out.append((kind, (int(p.parent.parent.name), int(p.parent.name), int(p.stem)), p))
    return out


def _inside(t: tm.Tile, shard: tm.Tile) -> bool:
    return t[0] >= shard[0] and tm.ancestor(t, shard[0]) == shard


def absorb(served: Path, shard_dir: Path) -> dict:
    """Replace one shard's tiles in `served`. Returns the shard summary with the levels it brought."""
    summary = shard_summary(shard_dir)
    shard = tm.parse_tile(summary["shard"])
    incoming = _tiles(shard_dir)
    if any(not _inside(t, shard) for _, t, _ in incoming):
        raise ValueError(f"shard {summary['shard']} holds tiles outside itself")
    levels = sorted({t[0] for _, t, _ in incoming})
    for _, t, p in _tiles(served):
        if t[0] in levels and _inside(t, shard):
            p.unlink()
    for kind, t, p in incoming:
        dest = served / kind / str(t[0]) / str(t[1]) / p.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(f".{dest.name}.new")
        shutil.copyfile(p, tmp)
        os.replace(tmp, dest)
    record = {**summary, "levels": [levels[0], levels[-1]] if levels else []}
    (served / "shards").mkdir(parents=True, exist_ok=True)
    (served / "shards" / f"{shard[0]}-{shard[1]}-{shard[2]}.json").write_text(json.dumps(record))
    return record


def regions(served: Path) -> list[dict]:
    return [json.loads(p.read_text()) for p in sorted((served / "shards").glob("*.json"))] if (served / "shards").exists() else []


def rebuild_manifest(served: Path, name: str, sources: dict | None = None, rgb: dict | None = None,
                     bounds: tm.Bounds = (-180.0, -90.0, 180.0, 90.0)) -> dict:
    """Manifest from what is on disk now, plus the regions (shards) and their levels; written atomically."""
    present = scan(served)
    if not present:
        raise ValueError(f"no tiles under {served}")
    nl = ndvi_levels(served)
    m = manifest(name, (min(present), max(present)), present, ndvi=nl is not None, sources=sources, bounds=bounds,
                 rgb=rgb if (served / "rgb").exists() else None, ndvi_levels=nl)
    m["regions"] = regions(served)
    write_manifest(served, m)
    return m
