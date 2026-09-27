import pytest

from atlas_pipeline.config import FetchSettings, GlobalSearch
from atlas_pipeline.gbif_fetch import FetchError
from atlas_pipeline.gbif_global import (
    SensitiveSpeciesError,
    box_params,
    fetch_class_totals,
    fetch_species_cells,
    parse_month_facet,
    resolve_taxon,
    sub_boxes,
    world_boxes,
)
from atlas_pipeline.global_ranges import fetch_global, load_global_ranges

SETTINGS = FetchSettings()
SEARCH = GlobalSearch(levels=(20, 5, 1))


class FakeGbif:
    """Species occurs only in the 1° cells (-20, 30) and (26, 94); everything else is empty."""

    OCCUPIED = {(-20, 30), (26, 94)}

    def __init__(self):
        self.calls = 0

    def __call__(self, url, params):
        self.calls += 1
        if url.endswith("/species/match"):
            return {"usageKey": 9, "speciesKey": 9, "canonicalName": params["name"], "matchType": "EXACT",
                    "classKey": 212, "class": "Aves", "vernacularName": "Amur Falcon", "family": "Falconidae"}
        lat0, lat1 = (float(v) for v in params["decimalLatitude"].split(","))
        lng0, lng1 = (float(v) for v in params["decimalLongitude"].split(","))
        hits = [c for c in self.OCCUPIED if lat0 <= c[0] <= lat1 and lng0 <= c[1] <= lng1]
        if "classKey" in params:
            return {"count": 1200, "facets": [{"counts": [{"name": str(m), "count": 100} for m in range(1, 13)]}]}
        if params.get("facet") == "month":
            month = 12 if hits and hits[0][0] < 0 else 10
            return {"count": 30 if hits else 0, "facets": [{"counts": [{"name": str(month), "count": 30}]}] if hits else []}
        return {"count": 30 * len(hits)}


def test_world_boxes_cover_globe():
    boxes = list(world_boxes(20))
    assert len(boxes) == 9 * 18
    assert (-90, -180) in boxes and (70, 160) in boxes


def test_sub_boxes_clip_at_poles():
    assert len(list(sub_boxes(80, 160, 20, 5))) == 2 * 4


def test_box_params_clip():
    p = box_params(80, 170, 20, SETTINGS)
    assert p["decimalLatitude"].startswith("80,89.99")
    assert p["decimalLongitude"].startswith("170,179.99")


def test_parse_month_facet():
    assert parse_month_facet({"count": 3, "facets": [{"counts": [{"name": "10", "count": 3}]}]})[9] == 3
    with pytest.raises(FetchError):
        parse_month_facet({"oops": 1})


def test_adaptive_search_finds_only_occupied_cells(tmp_path):
    fake = FakeGbif()
    taxon = resolve_taxon("Falco amurensis", tmp_path, fake)
    cells = fetch_species_cells(taxon, tmp_path, fake, SETTINGS, SEARCH)
    assert set(cells) == {"-20_30", "26_94"}
    assert cells["-20_30"][11] == 30 and cells["26_94"][9] == 30
    # 162 coarse + 2*16 medium + 2*25 fine, far fewer than a full 1° world grid
    assert fake.calls == 1 + 162 + 32 + 50
    calls = fake.calls
    fetch_species_cells(taxon, tmp_path, fake, SETTINGS, SEARCH)
    assert fake.calls == calls  # cached


def test_class_totals(tmp_path):
    totals = fetch_class_totals("212", ["26_94"], tmp_path, FakeGbif(), SETTINGS)
    assert totals["26_94"] == [100] * 12


def test_sensitive_species_refused(tmp_path):
    with pytest.raises(SensitiveSpeciesError):
        resolve_taxon("Panthera tigris", tmp_path, FakeGbif())


def test_unmatched_species(tmp_path):
    with pytest.raises(FetchError, match="could not match"):
        resolve_taxon("Nonexistent bird", tmp_path, lambda url, params: {"matchType": "NONE"})


def test_fetch_global_roundtrip(tmp_path):
    done = fetch_global(tmp_path, FakeGbif(), SETTINGS, ("Falco amurensis", "Panthera tigris"))
    assert done == ["9"]
    [gr] = load_global_ranges(tmp_path)
    assert gr.name["common"] == "Amur Falcon"
    counts, totals = gr.cells["-20_30"]
    assert counts[11] == 30 and totals[11] == 100
