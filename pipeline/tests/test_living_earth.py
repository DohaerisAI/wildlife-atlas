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
