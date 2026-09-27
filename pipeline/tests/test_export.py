from atlas_pipeline.aggregate import CellSummary
from atlas_pipeline.export import SourceInfo, build_bundle, write_bundle

SRC = SourceInfo("test", "", "2020", False, "")
CELLS = [
    CellSummary("10_76", (100,) * 12, {"1": (10,) * 12, "2": (0,) * 9 + (20, 20, 0)}),
    CellSummary("11_76", (0,) * 12, {}),
]
NAMES = {"1": {"scientific": "Pavo cristatus", "common": "Indian Peafowl"}}


def test_bundle_contents():
    files = build_bundle(CELLS, NAMES, 1.0, SRC)
    assert [c["id"] for c in files["cells.json"]["cells"]] == ["10_76"]  # empty cell dropped
    index = files["cells.json"]["cells"][0]
    assert index["richness"][9] == 2 and index["richness"][0] == 1
    assert index["coverage"][0] == "some"

    cell = files["cells/10_76.json"]
    labels = {s["k"]: s["p"] for s in cell["species"]}
    assert labels == {"1": "resident", "2": "passage"}

    months = {s["k"]: s["m"] for s in cell["species"]}
    assert months["2"] == [0] * 9 + [1, 1, 0]
    assert files["species/1.json"]["cells"]["10_76"]["r"][0] == 0.1
    names = {s["k"]: s["name"] for s in files["species.json"]}
    assert names == {"1": "Indian Peafowl", "2": "2"}  # unnamed falls back to key
    assert files["meta.json"]["source"]["demo"] is False


def test_write_bundle(tmp_path):
    out = tmp_path / "data"
    write_bundle(build_bundle(CELLS, NAMES, 1.0, SRC), out)
    assert (out / "cells" / "10_76.json").exists()
    assert (out / "species.json").exists()
    (out / "species" / "old.json").write_text("{}")
    write_bundle(build_bundle(CELLS, NAMES, 1.0, SRC), out)
    assert not (out / "species" / "old.json").exists()


def test_global_ranges_extend_and_override():
    from atlas_pipeline.global_ranges import GlobalRange

    africa = GlobalRange(
        "9", {"scientific": "Falco amurensis", "common": "Amur Falcon"},
        {"-20_30": ((0,) * 11 + (20,), (100,) * 12), "10_76": ((5,) * 12, (50,) * 12)},
    )
    files = build_bundle(CELLS, NAMES, 1.0, SRC, global_ranges=(africa,))
    assert files["species/9.json"]["cells"]["-20_30"]["r"][11] == 0.2
    assert files["species/9.json"]["cells"]["10_76"]["r"][0] == 0.1
    assert "cells/-20_30.json" not in files  # detail lists stay India-only
    entry = next(s for s in files["species.json"] if s["k"] == "9")
    assert entry["name"] == "Amur Falcon" and entry["cells"] == 2
    assert files["meta.json"]["coverage"]["ranges"].startswith("worldwide")
