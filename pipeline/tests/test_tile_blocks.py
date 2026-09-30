import numpy as np
import pytest

from atlas_pipeline.tile_blocks import block_side, cut, plan_blocks, rect_of, split


def test_block_side_fits_the_response_budget():
    assert block_side(7) == 4  # 1024 px x 7 float bands = 29 MB; 2048 px would be 117 MB
    assert block_side(3) == 4  # 2048 px x 3 bands = 50 MB, over budget
    assert block_side(1) == 8  # 2048 px x 1 band = 16 MB, capped at 2048 px
    assert block_side(12, tile_px=64) == 8  # NDVI grid: 512 px x 12 bands = 12.6 MB
    assert block_side(500) == 1


def test_plan_blocks_groups_by_ancestor_and_respects_the_floor():
    tiles = [(9, x, y) for x in range(8) for y in range(4)]
    blocks = plan_blocks(tiles, 4)
    assert len(blocks) == 2 * 1  # 8 x 4 tiles in blocks of 4 x 4
    assert sum(len(b) for b in blocks) == len(tiles)
    assert len(plan_blocks(tiles, 4, floor_level=9)) == len(tiles)  # the floor keeps blocks inside a level-9 shard
    with pytest.raises(ValueError):
        plan_blocks([(9, 0, 0), (8, 0, 0)], 4)


def test_cut_returns_each_tile_from_the_block():
    tiles = [(9, 4, 2), (9, 5, 3)]
    rect = rect_of(tiles)
    assert rect == (4, 2, 2, 2)
    block = np.arange(2 * 4 * 2 * 4 * 1, dtype=float).reshape(8, 8, 1)
    out = cut(block, rect, tiles, px=4)
    assert out[(9, 4, 2)].shape == (4, 4, 1)
    assert out[(9, 4, 2)][0, 0, 0] == block[0, 0, 0]
    assert out[(9, 5, 3)][0, 0, 0] == block[4, 4, 0]
    with pytest.raises(ValueError):
        cut(np.zeros((4, 8, 1)), rect, tiles, px=4)


def test_split_quarters_down_to_single_tiles():
    tiles = [(9, x, y) for x in range(4) for y in range(4)]
    parts = split(tiles)
    assert len(parts) == 4 and all(len(p) == 4 for p in parts)
    assert sorted(t for p in parts for t in p) == sorted(tiles)
    assert split([(9, 1, 1), (9, 2, 1)]) == [[(9, 1, 1)], [(9, 2, 1)]]


class _FakeEE:
    class EEException(Exception):
        pass


def _fake_fetch(calls, fail):
    """computePixels stand-in: each pixel holds its global column; `fail(piece)` returns an error message or None."""
    def fetch(ee, expr, width, height, piece, bands):
        calls.append((expr, piece))
        msg = fail(expr, piece)
        if msg:
            raise _FakeEE.EEException(msg)
        x, y, w, h = piece
        cols = np.broadcast_to(np.arange(x, x + w, dtype=float)[None, :, None], (h, w, len(bands)))
        return np.array(cols)
    return fetch


def test_pull_tiles_uses_one_call_per_block(monkeypatch):
    from atlas_pipeline import tiles_ee
    calls = []
    monkeypatch.setattr(tiles_ee, "_fetch", _fake_fetch(calls, lambda e, p: None))
    todo = [(9, x, y) for x in range(4) for y in range(4)]
    out = tiles_ee._pull_tiles(_FakeEE, "img", ["a", "b"], todo, 9, 2, "t", floor_level=6)
    assert len(calls) == 1 and set(out) == set(todo)
    assert out[(9, 2, 1)][0, 0, 0] == 2 * 256


def test_pull_tiles_splits_a_block_that_times_out_and_falls_back_per_tile(monkeypatch):
    from atlas_pipeline import tiles_ee
    calls = []
    def fail(expr, piece):
        if piece[2] > 256:
            return "Computation timed out."
        if expr == "img" and piece[0] == 0:
            return "Unable to transform edge"
        return None
    monkeypatch.setattr(tiles_ee, "_fetch", _fake_fetch(calls, fail))
    todo = [(9, x, 0) for x in range(2)]
    out = tiles_ee._pull_tiles(_FakeEE, "img", ["a"], todo, 9, 1, "t", fallback="polar", floor_level=6)
    assert set(out) == set(todo)
    assert ("polar", (0, 0, 256, 256)) in calls  # the tile outside the footprint came from the fallback
    assert not any(e == "polar" and p[0] == 256 for e, p in calls)


def test_pull_tiles_raises_errors_it_cannot_work_around(monkeypatch):
    from atlas_pipeline import tiles_ee
    monkeypatch.setattr(tiles_ee, "_fetch", _fake_fetch([], lambda e, p: "Image.select: band not found"))
    with pytest.raises(_FakeEE.EEException):
        tiles_ee._pull_tiles(_FakeEE, "img", ["a"], [(9, 0, 0), (9, 1, 0)], 9, 1, "t")
