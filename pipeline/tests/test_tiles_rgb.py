import json
from unittest.mock import MagicMock

import numpy as np
from PIL import Image

from atlas_pipeline import tile_math as tm
from atlas_pipeline.ee_groups import run_groups
from atlas_pipeline.tile_product import save_jpg, tile_path
from atlas_pipeline.tiles_rgb import MODIS, PULL_LEVEL, add_to_manifest, derive_levels, modis_rgb_image, reduce_rgb, upsample_quarter


def test_reduce_rgb_means_children_and_leaves_missing_ones_black():
    red = np.zeros((256, 256, 3), np.uint8)
    red[..., 0] = 200
    out = reduce_rgb([red, None, None, red])
    assert out.shape == (256, 256, 3)
    assert (out[:128, :128, 0] == 200).all() and (out[128:, 128:, 0] == 200).all()
    assert (out[:128, 128:] == 0).all()
    assert reduce_rgb([None] * 4) is None


def test_derive_levels_writes_parents_down_to_bottom(tmp_path):
    t = (8, 360, 101)
    save_jpg(np.full((256, 256, 3), 120, np.uint8), tile_path(tmp_path, "rgb", t))
    derive_levels(tmp_path, 8, 6, {t}, log=lambda *_: None)
    for z in (7, 6):
        p = tile_path(tmp_path, "rgb", tm.ancestor(t, z))
        assert p.exists()
    a = np.asarray(Image.open(tile_path(tmp_path, "rgb", tm.parent(t))))
    i = tm.children(tm.parent(t)).index(t)
    y, x = divmod(i, 2)
    assert abs(int(a[y * 128 + 64, x * 128 + 64, 1]) - 120) <= 3  # jpeg


def test_manifest_declares_rgb_with_source_and_licence(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps({"name": "detail", "rgb": None}))
    add_to_manifest(tmp_path)
    m = json.loads((tmp_path / "manifest.json").read_text())
    assert m["rgb"]["path"] == "rgb/{z}/{x}/{y}.jpg" and MODIS in m["rgb"]["source"] and m["rgb"]["license"]


def test_modis_image_keeps_the_native_grid():
    ee = MagicMock()
    modis_rgb_image(ee, 8)
    ee.ImageCollection.assert_any_call(MODIS)
    # the composite is pinned to MODIS' own projection before resampling (else Earth Engine averages at 1 degree)
    mean = ee.ImageCollection.fromImages.return_value.select.return_value.mean.return_value
    mean.setDefaultProjection.assert_called_once()


def test_run_groups_pulls_each_level5_group_once():
    seen = []
    todo = [(8, 360, 101), (8, 361, 101), (8, 0, 0)]
    n = run_groups(todo, lambda ts: seen.append(ts) or len(ts), 2, lambda *_: None, "t")
    assert n == 3 and sorted(len(s) for s in seen) == [1, 2]


def test_level8_is_the_parent_quarter_scaled_up():
    parent = np.zeros((256, 256, 3), np.uint8)
    parent[128:, 128:] = 90  # the bottom-right quarter
    up = upsample_quarter(parent, 3)
    assert up.shape == (256, 256, 3) and abs(int(up[128, 128, 0]) - 90) <= 1
    assert (upsample_quarter(parent, 0) == 0).all()
    assert PULL_LEVEL == 7  # MODIS is 463 m; level 8 (~300 m) would only scale it up at 4x the Earth Engine cost
