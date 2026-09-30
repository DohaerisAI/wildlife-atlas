import json
from unittest.mock import MagicMock

import numpy as np
import pytest
from PIL import Image

from atlas_pipeline import coast_mask as cm
from atlas_pipeline import tile_math as tm
from atlas_pipeline.coast_patch import derive_coarse, patch_fine, patch_tileset
from atlas_pipeline.living_earth_v2 import WATER_CLASS
from atlas_pipeline.tile_product import save_png, tile_path
from atlas_pipeline.tile_raster import block_mode

W = WATER_CLASS


def _land(cls, tree=40, shade=181):
    cls = np.asarray(cls, np.uint8)
    return np.stack([cls, np.where(cls == 0, 0, tree).astype(np.uint8), np.full(cls.shape, shade, np.uint8)], axis=-1)


def test_share_byte_and_threshold_match_land_class():
    b = cm.share_byte(np.array([0.0, 0.49, 0.5, 1.0, np.nan]))
    assert list(b) == [0, 125, 128, 255, 0]
    assert list(cm.is_sea(b)) == [False, False, True, True, False]


def test_patch_fine_turns_only_sea_water_into_ocean():
    rgb = _land([[W, W, 1, 0]])
    mask = np.array([[255, 0, 255, 255]], np.uint8)  # sea, lake/river, land under sea mask, ocean
    out = patch_fine(rgb, mask)
    assert list(out[0, :, 0]) == [0, W, 1, 0]
    assert list(out[0, :, 1]) == [0, 40, 40, 0]  # tree zeroed where it became ocean, as land_rgb does
    assert list(out[0, :, 2]) == [181] * 4  # hillshade untouched
    assert rgb[0, 0, 0] == W  # input not mutated


def test_derive_coarse_matches_the_builders_mode_and_touches_only_water():
    below = np.array([[W, 0, 3, 3], [0, 0, 3, W]], np.uint8)  # two 2x2 blocks
    old = _land(block_mode(below, 2))
    assert list(old[0, :, 0]) == [W, 3]
    patched = np.where(below == W, 0, below).astype(np.uint8)
    out = derive_coarse(old, patched)
    assert list(out[0, :, 0]) == [0, 3] and out[0, 0, 1] == 0 and out[0, 1, 1] == 40


def test_coastal_tiles_skip_inland_water_and_wrap_the_antimeridian():
    z = 2
    present = {(x, y) for x in range(tm.cols(z)) for y in range(tm.rows(z))} - {(0, 0)}
    water = {(1, 1), (5, 2), (7, 1)}
    ocean = {(4, 2)}
    # (1,1) neighbours the missing (0,0); (5,2) neighbours ocean (4,2); (7,1) wraps to (0,0); nothing else sees sea
    assert cm.coastal_tiles(z, present, water, ocean) == {(1, 1), (5, 2), (7, 1)}
    assert cm.coastal_tiles(z, present, {(2, 1)}, ocean) == set()  # a lake far from any ocean is never requested


def test_plan_round_trips_and_groups_into_shards(tmp_path):
    tiles = {(10, 20), (11, 20), (400, 100)}
    path = tmp_path / "plan.json"
    path.write_text(json.dumps(cm.plan_payload(8, tiles)))
    assert cm.read_plan(path) == (8, tiles)
    assert cm.plan_shards(8, tiles) == sorted({tm.ancestor((8, x, y), 3) for x, y in tiles})


def test_committed_plan_is_level_8_coastal_tiles():
    level, tiles = cm.read_plan()
    assert level == 8 and tiles  # written by `atlas coast-plan` from the served detail tiles


def test_sea_image_uses_glo30_wbm_ocean():
    from atlas_pipeline.coast_ee import sea_image
    from atlas_pipeline.tiles_ee import COAST_WBM_OCEAN

    ee = MagicMock()
    sea_image(ee, 8)
    assert ("WBM",) in [c.args for c in ee.ImageCollection.return_value.select.call_args_list]
    eq = ee.ImageCollection.return_value.select.return_value.mosaic.return_value.setDefaultProjection.return_value.eq
    eq.assert_called_with(COAST_WBM_OCEAN)


def _tile(root, t, cls):
    save_png(_land(cls), tile_path(root, "land", t))


def test_patch_tileset_patches_fine_rederives_coarse_and_keeps_originals(tmp_path):
    root, coast, backup = tmp_path / "tiles", tmp_path / "coast", tmp_path / "backup"
    fine = (8, 360, 80)
    sea_half = np.full((256, 256), W, np.uint8)  # all water: the left half is near-shore sea, the right half a lagoon
    _tile(root, fine, sea_half)
    for s in tm.children(tm.parent(fine)):
        if s != fine:
            _tile(root, s, np.full((256, 256), 1, np.uint8))
    parent = tm.parent(fine)
    kids = [np.asarray(sea_half) if s == fine else np.full((256, 256), 1, np.uint8) for s in tm.children(parent)]
    _tile(root, parent, block_mode(np.block([kids[:2], kids[2:]]), 2))
    mask = np.zeros((256, 256), np.uint8)
    mask[:, :128] = 255
    cm.write_mask(coast, fine, mask)
    cm.write_manifest(coast, requested=1)

    summary = patch_tileset(root, coast, 8, 7, backup=backup, workers=1, log=lambda *_: None)
    assert summary["8"] == {"masks": 1, "tiles": 1, "pixels": 256 * 128}
    got = np.asarray(Image.open(tile_path(root, "land", fine)))
    assert (got[:, :128, 0] == 0).all() and (got[:, 128:, 0] == W).all()
    up = np.asarray(Image.open(tile_path(root, "land", parent)))[..., 0]
    assert summary["7"]["tiles"] == 1 and (up[:128, :64] == 0).all() and (up[:128, 64:128] == W).all()
    assert tile_path(backup, "land", fine).exists()  # the original is kept before the first overwrite
    assert (np.asarray(Image.open(tile_path(backup, "land", fine)))[..., 0] == W).all()
    assert not list(root.rglob(".*.tmp"))
    again = patch_tileset(root, coast, 8, 7, backup=backup, workers=1, log=lambda *_: None)
    assert again["8"]["tiles"] == 0 and again["7"]["tiles"] == 0  # idempotent
    assert (np.asarray(Image.open(tile_path(backup, "land", fine)))[..., 0] == W).all()  # backup still the original


def test_patch_tileset_bbox_limits_the_masks(tmp_path):
    root, coast = tmp_path / "tiles", tmp_path / "coast"
    fine = (8, 360, 80)
    _tile(root, fine, np.full((256, 256), W, np.uint8))
    cm.write_mask(coast, fine, np.full((256, 256), 255, np.uint8))
    far = (-10.0, -10.0, -9.0, -9.0)
    assert patch_tileset(root, coast, 8, 8, bbox=far, workers=1, log=lambda *_: None)["8"]["masks"] == 0


def test_write_mask_rejects_wrong_shape(tmp_path):
    with pytest.raises(ValueError):
        cm.write_mask(tmp_path, (8, 0, 0), np.zeros((10, 10), np.uint8))


def test_parse_bbox():
    assert tm.parse_bbox("72,18,73.5,19") == (72.0, 18.0, 73.5, 19.0)
    with pytest.raises(ValueError):
        tm.parse_bbox("73,18,72,19")
