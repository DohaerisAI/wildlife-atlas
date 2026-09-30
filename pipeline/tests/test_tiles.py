import json

import numpy as np
import pytest
from PIL import Image

from atlas_pipeline import tile_math as tm
from atlas_pipeline.tile_product import Mosaic, manifest, scan, tile_path, world_level, write_manifest, write_shard, write_world
from atlas_pipeline.tile_raster import (block_mean, block_mode, exaggeration, hillshade, ndvi_atlas, resample_bilinear,
                                        resample_nearest)


# ---------- tile math (mirrors web/src/engine/tiles/tile-math.test.ts) ----------

def test_level_zero_is_two_hemispheres():
    assert (tm.cols(0), tm.rows(0)) == (2, 1)
    assert tm.bounds((0, 0, 0)) == (-180.0, -90.0, 0.0, 90.0)
    assert tm.bounds((0, 1, 0)) == (0.0, -90.0, 180.0, 90.0)


def test_bounds_and_tile_at_agree():
    for lng, lat, z in [(73.86, 18.52, 8), (80.83, 24.58, 7), (-60.0, -3.1, 5), (179.99, -89.99, 6), (-180.0, 90.0, 3)]:
        t = tm.tile_at(lng, lat, z)
        w, s, e, n = tm.bounds(t)
        assert w <= lng <= e and s <= lat <= n


def test_pixel_size_near_300_m_at_level_8():
    assert tm.pixel_km(8) == pytest.approx(0.306, abs=0.002)
    assert tm.pixel_km(3) == pytest.approx(9.78, abs=0.01)  # the pack's 4096-wide land.png grid


def test_family_tree():
    t = (5, 44, 12)
    kids = tm.children(t)
    assert all(tm.parent(k) == t for k in kids) and len(set(kids)) == 4
    assert tm.ancestor((8, 357, 99), 5) == (5, 44, 12)
    assert len(tm.descendants((3, 11, 3), 5)) == 16
    with pytest.raises(ValueError):
        tm.parent((0, 0, 0))
    with pytest.raises(ValueError):
        tm.check((2, 8, 0))


def test_tiles_in_bbox_and_plan():
    tiles = tm.tiles_in_bbox(3, (66, 5, 99, 38))
    assert tiles == [(3, x, y) for y in (2, 3) for x in (10, 11, 12)]
    land = np.zeros((16, 32), dtype=bool)
    land[5, 21] = True  # one land pixel in level-3 tile x=10..11 area
    assert tm.plan_shards(land, (66, 5, 99, 38)) != []
    assert tm.plan_shards(np.zeros((16, 32), dtype=bool), (66, 5, 99, 38)) == []
    assert tm.parse_tile(" 3/11/3 ") == (3, 11, 3)
    with pytest.raises(ValueError):
        tm.parse_tile("3/11")


def test_land_tiles_grow_coasts_and_handle_fine_levels():
    land = np.zeros((8, 16), dtype=bool)
    land[3, 5] = True
    assert tm.land_tiles(land, 2, dilate=0) == {(2, 1)}
    assert (2, 2) in tm.land_tiles(land, 2, dilate=2) or (2, 1) in tm.land_tiles(land, 2, dilate=2)
    fine = tm.land_tiles(land, 4, dilate=0)  # 64 x 16 tiles over an 16 x 8 mask
    assert fine and all(0 <= x < 64 and 0 <= y < 16 for x, y in fine)


def test_index_roundtrip():
    present = {(0, 0), (5, 3), (63, 31)}
    enc = tm.encode_index(5, present)
    assert tm.decode_index(5, enc) == present
    assert tm.decode_index(0, tm.encode_index(0, {(1, 0)})) == {(1, 0)}


# ---------- rasters ----------

def test_block_mode_prefers_land_over_ocean():
    cls = np.array([[0, 0, 4, 4], [0, 3, 4, 1], [0, 0, 0, 0], [0, 0, 0, 0]], dtype=np.uint8)
    assert block_mode(cls, 2).tolist() == [[3, 4], [0, 0]]
    with pytest.raises(ValueError):
        block_mode(np.zeros((3, 4), np.uint8), 2)


def test_block_mean_ignores_nan():
    a = np.array([[1.0, np.nan], [3.0, np.nan]])
    assert block_mean(a, 2)[0, 0] == pytest.approx(2.0)
    assert np.isnan(block_mean(np.full((2, 2), np.nan), 2)[0, 0])


def test_hillshade_flat_and_facing_the_sun():
    flat = hillshade(np.zeros((8, 8)), 0.01, 20.0, 1.0)
    assert np.all(np.abs(flat.astype(int) - 181) <= 1)
    # ground rising to the east faces west, away from a north-west sun only partly: darker than a west-rising slope
    ramp = np.tile(np.arange(8, dtype=float) * 200, (8, 1))
    east_up, west_up = hillshade(ramp, 0.01, 20.0, 1.0), hillshade(ramp[:, ::-1], 0.01, 20.0, 1.0)
    assert east_up.mean() > west_up.mean()  # faces west (toward the 315 sun) -> brighter


def test_exaggeration_shrinks_with_pixel_size():
    assert exaggeration(3) == pytest.approx(8.0, abs=0.1)
    assert exaggeration(8) == pytest.approx(1.5)
    assert exaggeration(6) < exaggeration(5)


def test_ndvi_atlas_layout_and_no_data():
    months = np.stack([np.full((64, 64), -0.2 + m * 0.09) for m in range(12)])
    months[3, 0, 0] = np.nan
    a = ndvi_atlas(months)
    assert a.shape == (192, 256)
    assert a[0, 64 * 3] == 0  # April's first pixel is no data
    assert a[64 * 2 + 1, 64 * 3 + 1] > a[1, 1]  # December greener than January here
    with pytest.raises(ValueError):
        ndvi_atlas(np.zeros((11, 64, 64)))


def test_resamplers_keep_values():
    a = np.array([[1, 2], [3, 4]], dtype=np.uint8)
    assert resample_nearest(a, 4, 4)[0].tolist() == [1, 1, 2, 2]
    b = resample_bilinear(np.array([[0.0, 10.0]]), 1, 4)
    assert b[0, 0] == pytest.approx(0.0) and b[0, -1] == pytest.approx(10.0) and 0 < b[0, 1] < b[0, 2]


# ---------- product ----------

def _mosaic(shard=(3, 11, 3), level=5):
    n = 256 * 2 ** (level - shard[0])
    cls = np.zeros((n, n), np.uint8)
    cls[:256, :256] = 1  # land only in the first finest tile
    tree = np.full((n, n), 50.0)
    elev = np.tile(np.arange(n, dtype=float), (n, 1))
    ndvi = np.full((12, n // 4, n // 4), 0.5)
    return Mosaic(shard, level, cls, tree, elev, ndvi)


def test_write_shard_skips_ocean_and_builds_the_pyramid(tmp_path):
    written = write_shard(tmp_path, _mosaic(), 4)
    tiles = {t for t, _ in written}
    assert (5, 44, 12) in tiles and (4, 22, 6) in tiles and (3, 11, 3) not in tiles
    assert all(t[0] in (4, 5) for t in tiles)
    assert len([t for t in tiles if t[0] == 5]) == 1  # the other 15 finest tiles are ocean
    land = np.asarray(Image.open(tile_path(tmp_path, "land", (5, 44, 12))))
    assert land.shape == (256, 256, 3) and land[0, 0, 0] == 1 and land[0, 0, 1] == 128
    ndvi = np.asarray(Image.open(tile_path(tmp_path, "ndvi", (4, 22, 6))))
    assert ndvi.shape == (192, 256)
    assert scan(tmp_path) == {5: {(44, 12)}, 4: {(22, 6)}}


def test_mosaic_checks_shapes():
    with pytest.raises(ValueError):
        Mosaic((3, 0, 0), 4, np.zeros((10, 10), np.uint8), np.zeros((10, 10)), np.zeros((10, 10)), None)


def test_world_levels_cut_from_the_pack(tmp_path):
    land = np.zeros((2048, 4096, 3), np.uint8)
    land[1000:1100, 3000:3100] = (4, 200, 181)
    assert world_level(land, 3).shape == (2048, 4096, 3)
    assert world_level(land, 1).shape == (512, 1024, 3)
    up = world_level(land, 4)
    assert up.shape == (4096, 8192, 3) and up[2100, 6100, 0] == 4
    written = write_world(tmp_path, land, range(0, 2))
    # the block straddles the equator and 90E: one level-0 tile, four level-1 tiles
    assert {t for t, _ in written} == {(0, 1, 0), (1, 2, 0), (1, 3, 0), (1, 2, 1), (1, 3, 1)}


def test_manifest_has_sources_and_index(tmp_path):
    m = manifest("detail", (5, 6), {5: {(44, 12)}}, ndvi=True)
    assert m["kind"] == "living-earth-tiles" and m["levels"] == [5, 6]
    assert all(c["source"] for c in m["land"]["channels"])
    assert tm.decode_index(5, m["index"]["5"]) == {(44, 12)} and m["counts"]["6"] == 0
    assert manifest("world", (0, 4), {}, ndvi=False)["ndvi"] is None
    path = write_manifest(tmp_path, m)
    assert json.loads(path.read_text())["name"] == "detail"


def test_rate_limits_are_retried():
    from atlas_pipeline.tiles_ee import retryable
    assert retryable("Too Many Requests: Request was rejected because the concurrency limit was exceeded.")
    assert retryable("Computation timed out.")
    assert not retryable("Image.select: Pattern 'foo' did not match any bands.")


def test_site_boxes_hold_whole_level_9_tiles():
    boxes = tm.site_boxes("73.856,18.52; 34.83,-2.33", 9)
    assert len(boxes) == 2
    w, s, e, n = boxes[0]
    assert w < 73.856 < e and s < 18.52 < n and e - w == pytest.approx(3 * tm.span(9))
    pune11 = tm.tile_at(73.856, 18.52, 11)
    assert tm.inside_any(pune11, boxes) and tm.inside_any(tm.tile_at(73.856, 18.52, 9), boxes)
    assert not tm.inside_any(tm.tile_at(73.856, 18.52, 7), boxes)  # a level-7 tile is bigger than the box
    assert not tm.inside_any(tm.tile_at(0, 0, 11), boxes)


def test_rgb_bytes_display_curve():
    from atlas_pipeline.tiles_ee_fine import rgb_bytes
    b = rgb_bytes(np.array([[[0.0, 0.3, np.nan], [0.075, 1.0, 0.03]]]))
    assert b[0, 0].tolist()[:2] == [0, 255] and b[0, 0, 2] == 0
    assert 100 < b[0, 1, 0] < 140 and b[0, 1, 1] == 255


def test_town_levels_use_dem_shade_and_write_true_colour(tmp_path):
    base = _mosaic()
    n = base.cls.shape[0]
    shade = np.full((n, n), 90.0)
    rgb = np.full((n, n, 3), 120, np.uint8)
    m = Mosaic(base.shard, base.level, base.cls, base.tree, base.elev, base.ndvi, shade=shade, rgb=rgb)
    write_shard(tmp_path, m, 4)
    land = np.asarray(Image.open(tile_path(tmp_path, "land", (5, 44, 12))))
    assert land[10, 10, 2] == 90  # shade taken as given, not recomputed from the ramp
    jpg = np.asarray(Image.open(tile_path(tmp_path, "rgb", (4, 22, 6))))
    assert jpg.shape == (256, 256, 3) and abs(int(jpg[5, 5, 0]) - 120) <= 3
    with pytest.raises(ValueError):
        Mosaic(base.shard, base.level, base.cls, base.tree, base.elev, base.ndvi, rgb=np.zeros((2, 2, 3), np.uint8))
    mf = manifest("sites", (9, 11), {9: {(1, 1)}}, ndvi=True, rgb={"source": "S2", "license": "Copernicus"})
    assert mf["rgb"]["path"].endswith(".jpg") and mf["rgb"]["license"]


# ---------- NDVI stops at level 9; town levels 10-11 sample it ----------

def test_ndvi_level_is_capped_at_9():
    from atlas_pipeline.tiles_ee import ndvi_level, ndvi_tiles
    assert [ndvi_level(z) for z in (5, 8, 9, 10, 11)] == [5, 8, 9, 9, 9]
    todo = [(11, 2803, 402), (11, 2800, 400), (11, 2804, 400)]
    assert ndvi_tiles(todo, 9) == [(9, 700, 100), (9, 701, 100)]
    assert ndvi_tiles(todo, 11) == sorted(todo)


def test_town_shard_writes_ndvi_only_down_to_its_level(tmp_path):
    shard, level = (9, 700, 100), 11
    n = 256 * 4
    cls = np.ones((n, n), np.uint8)
    m = Mosaic(shard, level, cls, np.full((n, n), 50.0), np.zeros((n, n)), np.full((12, 64, 64), 0.5), ndvi_level=9)
    write_shard(tmp_path, m, 9)
    assert len(list((tmp_path / "land/11").glob("*/*.png"))) == 16 and len(list((tmp_path / "land/10").glob("*/*.png"))) == 4
    assert not (tmp_path / "ndvi/10").exists() and not (tmp_path / "ndvi/11").exists()
    assert np.asarray(Image.open(tile_path(tmp_path, "ndvi", shard))).shape == (192, 256)
    from atlas_pipeline.tile_product import ndvi_levels
    assert ndvi_levels(tmp_path) == (9, 9)
    mf = manifest("sites", (9, 11), scan(tmp_path), ndvi=True, ndvi_levels=ndvi_levels(tmp_path))
    assert mf["ndvi"]["levels"] == [9, 9] and mf["levels"] == [9, 11]
    assert manifest("detail", (5, 8), {}, ndvi=True)["ndvi"]["levels"] == [5, 8]
    with pytest.raises(ValueError):  # the NDVI array must be at its own level's size
        Mosaic(shard, level, cls, np.zeros((n, n)), np.zeros((n, n)), np.zeros((12, 256, 256)), ndvi_level=9)


def test_town_dem_is_the_2024_release():
    from atlas_pipeline.tile_product import DETAIL_SOURCES
    from atlas_pipeline.tiles_ee_fine import DEM, SOURCES
    assert DEM == "COPERNICUS/DEM/GLO30_2024_1"
    assert DEM in SOURCES["shade"] and DEM in DETAIL_SOURCES["hillshade"]
