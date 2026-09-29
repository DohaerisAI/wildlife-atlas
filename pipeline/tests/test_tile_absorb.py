import json

import numpy as np
import pytest

from atlas_pipeline import tile_math as tm
from atlas_pipeline.tile_absorb import absorb, rebuild_manifest
from atlas_pipeline.tile_product import save_png, tile_path


def _shard(root, shard, tiles, value):
    for t in tiles:
        save_png(np.full((256, 256, 3), value, np.uint8), tile_path(root, "land", t))
    (root / f"shard-{shard[0]}-{shard[1]}-{shard[2]}.json").write_text(json.dumps({"shard": "/".join(map(str, shard)), "tiles": len(tiles)}))


def test_absorb_replaces_only_that_shard_and_lists_regions(tmp_path):
    served = tmp_path / "served"
    a, b = (6, 90, 25), (6, 91, 25)
    a_tiles = tm.descendants(a, 9)[:3]
    b_tiles = tm.descendants(b, 9)[:2]
    s1, s2, s3 = tmp_path / "a1", tmp_path / "b1", tmp_path / "a2"
    _shard(s1, a, a_tiles, 1)
    _shard(s2, b, b_tiles, 2)
    _shard(s3, a, a_tiles[:1], 3)  # a re-run of shard a with fewer tiles
    absorb(served, s1)
    absorb(served, s2)
    m = rebuild_manifest(served, "sites")
    assert m["counts"]["9"] == 5 and len(m["regions"]) == 2
    absorb(served, s3)
    m = rebuild_manifest(served, "sites")
    assert m["counts"]["9"] == 3  # shard a now has 1 tile, shard b kept its 2
    assert {r["shard"] for r in m["regions"]} == {"6/90/25", "6/91/25"}
    assert next(r for r in m["regions"] if r["shard"] == "6/90/25")["levels"] == [9, 9]
    assert not list(served.rglob(".*.new"))


def test_absorb_refuses_foreign_tiles(tmp_path):
    bad = tmp_path / "bad"
    _shard(bad, (6, 90, 25), [tm.descendants((6, 10, 10), 9)[0]], 1)
    with pytest.raises(ValueError, match="outside"):
        absorb(tmp_path / "served", bad)
