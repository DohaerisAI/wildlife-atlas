import json

import numpy as np
import pytest

from atlas_pipeline.living_earth import CLIMATE, SURFACE, from_byte, pack_atlas, to_byte, write_pack


def test_byte_roundtrip_within_one_step():
    ch = SURFACE[2]  # ndvi -0.2..0.9
    v = np.array([-0.2, 0.0, 0.45, 0.9, np.nan])
    back = from_byte(to_byte(v, ch), ch)
    assert np.allclose(back[:4], v[:4], atol=(ch.hi - ch.lo) / 255)
    assert back[4] == pytest.approx(ch.lo)  # no data decodes as the floor


def test_atlas_places_months_row_major():
    months = [np.full((2, 3, 3), i, dtype="uint8") for i in range(12)]
    a = pack_atlas(months)
    assert a.shape == (6, 12, 3)
    assert a[0, 0, 0] == 0 and a[0, 9, 0] == 3 and a[2, 0, 0] == 4 and a[5, 11, 0] == 11


def test_atlas_rejects_bad_input():
    with pytest.raises(ValueError, match="12 months"):
        pack_atlas([np.zeros((2, 2, 3), "uint8")] * 11)
    with pytest.raises(ValueError, match="shape"):
        pack_atlas([np.zeros((2, 2, 3), "uint8")] * 11 + [np.zeros((3, 2, 3), "uint8")])


def test_write_pack_manifest(tmp_path):
    surf = [np.zeros((4, 8, 3), "uint8")] * 12
    clim = [np.zeros((2, 4, 3), "uint8")] * 12
    m = write_pack(tmp_path, surf, clim)
    assert (tmp_path / "surface.png").exists() and (tmp_path / "climate.png").exists()
    saved = json.loads((tmp_path / "manifest.json").read_text())
    assert saved["surface"]["month"] == [8, 4] and saved["climate"]["month"] == [4, 2]
    assert [c["name"] for c in saved["climate"]["channels"]] == [c.name for c in CLIMATE]
    assert m["version"] == 1


class _FakeImage:
    """Records the Earth Engine calls made on it."""

    def __init__(self, ops=()):
        self.ops = tuple(ops)

    def __getattr__(self, name):
        return lambda *args: _FakeImage(self.ops + ((name, args),))


def test_water_share_weights_recurrence_by_the_cells_water_mask():
    from atlas_pipeline.living_earth import water_share

    ops = water_share(_FakeImage()).ops
    assert [o[0] for o in ops] == ["multiply", "unmask"]
    assert ops[0][1][0].ops == (("mask", ()),)  # recurrence x its own (fractional) mask
    assert ops[1][1] == (0,)  # cells that never held water are 0, not no-data


# ---------- pack v2 ----------

from atlas_pipeline import living_earth_v2 as v2  # noqa: E402


def test_worldcover_codes_map_to_the_contract_class_index():
    codes = np.array([10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100, 0, 255, np.nan])
    assert v2.worldcover_to_class(codes).tolist() == [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 0, 0]
    assert [c[1] for c in v2.LAND_CLASSES] == ["none", "tree", "shrub", "grass", "crop", "built", "bare", "snow", "water", "wetland", "mangrove", "moss"]


def test_land_class_sends_open_sea_to_zero_and_keeps_lakes():
    codes = np.array([10, 80, 80, 60, 10])
    land_share = np.array([1.0, 1.0, 1.0, 0.2, np.nan])
    sea_share = np.array([0.0, 1.0, 0.0, 0.0, 0.0])  # 80 + sea = coastal sea; 80 without = lake
    assert v2.land_class(codes, land_share, sea_share).tolist() == [1, 0, 8, 0, 0]


def test_elevation_16bit_roundtrip_and_clipping():
    m = np.array([-10994.0, -3863.0, 0.0, 206.0, 8848.4, np.nan, -20000.0, 70000.0])
    hi, lo = v2.encode_elevation(m)
    back = v2.decode_elevation(hi, lo)
    assert back[:5].tolist() == [-10994, -3863, 0, 206, 8848]
    assert back[5] == 0  # missing reads as sea level
    assert back[6] == -11000 and back[7] == 65535 - 11000
    assert (hi[2], lo[2]) == (11000 >> 8, 11000 & 0xFF)


def test_flagged_bytes_keep_no_data_distinct():
    ch = v2.OCEAN[0]
    v = np.array([ch.lo, 0.0, ch.hi, 5.0, np.nan])
    b = v2.to_byte_flagged(v, ch)
    assert b.tolist()[0] == 1 and b[2] == 255 and b[3] == 255 and b[4] == 0
    back = v2.from_byte_flagged(b, ch)
    assert abs(back[1]) <= (ch.hi - ch.lo) / 254 and np.isnan(back[4])


def test_log_scales():
    assert v2.log_lights(np.array([0.0, 9.0, -1.0, np.nan])).tolist() == [0.0, 1.0, 0.0, 0.0]
    c = v2.log_chlorophyll(np.array([0.1, 10.0, 0.0, np.nan]))
    assert c[:2].tolist() == pytest.approx([-1.0, 1.0]) and np.isnan(c[2]) and np.isnan(c[3])


def test_tiles_cover_the_grid_and_stitch_back():
    full = np.arange(10 * 7 * 2, dtype="float64").reshape(7, 10, 2)
    pieces = [((x, y, w, h), full[y:y + h, x:x + w]) for x, y, w, h in v2.tiles(10, 7, 4, 3)]
    assert len(pieces) == 9 and pieces[-1][0] == (8, 6, 2, 1)
    assert np.array_equal(v2.stitch(pieces, 10, 7), full)


def test_split_tile_halves_the_long_side():
    assert v2.split_tile((0, 0, 9, 4)) == [(0, 0, 4, 4), (4, 0, 5, 4)]
    assert v2.split_tile((2, 3, 4, 9)) == [(2, 3, 4, 4), (2, 7, 4, 5)]
    with pytest.raises(ValueError):
        v2.split_tile((0, 0, 1, 1))


def test_stitch_rejects_gaps_overlaps_and_bad_shapes():
    a = np.zeros((2, 2, 1))
    with pytest.raises(ValueError, match="zero times"):
        v2.stitch([((0, 0, 2, 2), a)], 4, 2)
    with pytest.raises(ValueError, match="more than once"):
        v2.stitch([((0, 0, 2, 2), a), ((0, 0, 2, 2), a), ((2, 0, 2, 2), a)], 4, 2)
    with pytest.raises(ValueError, match="shape"):
        v2.stitch([((0, 0, 2, 2), np.zeros((1, 2, 1)))], 2, 2)


def test_tile_grid_places_a_piece_on_the_globe():
    g = v2.tile_grid(360, 180, (90, 45, 10, 5))["affineTransform"]
    assert (g["translateX"], g["translateY"], g["scaleX"], g["scaleY"]) == (-90, 45, 1, -1)


def test_nanmean_stack_ignores_missing_years():
    out = v2.nanmean_stack([np.array([1.0, np.nan, np.nan]), np.array([3.0, 2.0, np.nan])])
    assert out[:2].tolist() == [2.0, 2.0] and np.isnan(out[2])


def test_write_pack_v2_files_and_manifest(tmp_path):
    surf = [np.zeros((4, 8, 3), "uint8")] * 12
    clim = [np.zeros((2, 4, 3), "uint8")] * 12
    ocean = [v2.ocean_frame(np.array([[0.2, np.nan]]), np.array([[0.0, np.nan]]), np.array([[1.0, np.nan]]))] * 12
    land = v2.land_image(np.array([[10, 0]]), np.array([[1.0, 0.0]]), np.array([[0.0, 1.0]]), np.array([[64.0, np.nan]]), np.array([[181.0, 200.0]]))
    relief = v2.relief_image(np.array([[8848.0, -3863.0]]), np.array([[40.0, 0.0]]))
    m = v2.write_pack_v2(tmp_path, surf, clim, ocean, land, relief)
    for name in ("surface", "climate", "ocean", "land", "relief"):
        assert (tmp_path / f"{name}.png").exists()
    saved = json.loads((tmp_path / "manifest.json").read_text())
    assert saved["version"] == 2 and m["version"] == 2
    assert saved["ocean"]["month"] == [2, 1] and saved["land"]["size"] == [2, 1] and saved["relief"]["size"] == [2, 1]
    assert [c["name"] for c in saved["ocean"]["channels"]] == ["current_u", "current_v", "chlorophyll"]
    assert all(set(c) >= {"name", "lo", "hi", "unit", "source"} for k in ("surface", "climate", "ocean", "land", "relief") for c in saved[k]["channels"])
    assert len(saved["classes"]) == 12 and saved["classes"][10]["name"] == "mangrove" and saved["attribution"]
    assert land[0, 0].tolist() == [1, 163, 181] and land[0, 1].tolist() == [0, 0, 200]
    assert ocean[0][0, 1].tolist() == [0, 0, 0] and ocean[0][0, 0, 2] > 0
    assert v2.decode_elevation(relief[..., 0], relief[..., 1]).tolist() == [[8848, -3863]]


class _FakeEE:
    """Enough of the ee module for pull(): pieces over `limit` pixels fail like Earth Engine does."""

    class EEException(Exception):
        pass

    def __init__(self, limit, footprint=(0, 10**9)):
        self.limit, self.footprint, self.calls = limit, footprint, []
        fake = self

        class Image:
            @staticmethod
            def cat(parts):
                return parts

        class Data:
            @staticmethod
            def computePixels(req):
                d, t = req["grid"]["dimensions"], req["grid"]["affineTransform"]
                fake.calls.append((d["width"], d["height"]))
                if d["width"] * d["height"] > fake.limit:
                    raise fake.EEException("User memory limit exceeded.")
                x0 = round((t["translateX"] + 180) / t["scaleX"])
                y0 = round((90 - t["translateY"]) / -t["scaleY"])
                if y0 < fake.footprint[0] or y0 + d["height"] > fake.footprint[1]:
                    raise fake.EEException("Unable to transform edge (40.000000, 1.000000 to 39.99, 1.0)")
                ys, xs = np.mgrid[y0:y0 + d["height"], x0:x0 + d["width"]]
                out = np.zeros((d["height"], d["width"]), dtype=[("a", "f4")])
                out["a"] = np.where(xs == 0, -1e6, ys * 100 + xs)  # column 0 is "masked"
                return out

        self.Image, self.data = Image, Data


def test_pull_splits_oversized_pieces_and_marks_masked_as_nan():
    from atlas_pipeline.living_earth_v2_ee import pull

    fake = _FakeEE(limit=300)
    arr = pull(fake, _FakeImage(), 40, 20, ["a"], (40, 20))
    assert arr.shape == (20, 40, 1)
    assert np.isnan(arr[:, 0, 0]).all() and arr[7, 9, 0] == 709 and arr[19, 39, 0] == 1939
    assert fake.calls[0] == (40, 20) and max(w * h for w, h in fake.calls[1:] if w * h <= 300) <= 300


def test_footprint_rows_and_pull_inside_them():
    from atlas_pipeline.living_earth_v2_ee import footprint_rows, pull

    fake = _FakeEE(limit=10**6, footprint=(3, 17))
    assert footprint_rows(fake, _FakeImage(), 40, 20, "a") == (3, 17)
    arr = pull(fake, _FakeImage(), 40, 20, ["a"], (40, 5), rows=(3, 17))
    assert arr.shape == (20, 40, 1) and np.isnan(arr[:3]).all() and np.isnan(arr[17:]).all()
    assert arr[3, 5, 0] == 305 and arr[16, 39, 0] == 1639
    with pytest.raises(fake.EEException, match="transform edge"):
        pull(fake, _FakeImage(), 40, 20, ["a"], (40, 5), retries=1)
