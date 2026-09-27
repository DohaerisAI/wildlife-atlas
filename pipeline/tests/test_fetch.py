import json

import pytest

from atlas_pipeline.aggregate import load_raw_cells, load_species_names
from atlas_pipeline.config import FetchSettings, Region
from atlas_pipeline.gbif_fetch import (
    backoff_seconds,
    FetchError,
    cell_query,
    fetch_region,
    fetch_species_names,
    parse_month_response,
)
from atlas_pipeline.grid import Cell

REGION = Region("IN", 10, 11, 76, 78, 1.0)
SETTINGS = FetchSettings()


class FakeGbif:
    """Cell 10_76 has birds, 10_77 is empty ocean."""

    def __init__(self):
        self.calls = []

    def __call__(self, url, params):
        self.calls.append((url, dict(params)))
        if "/species/" in url:
            return {"key": 1, "canonicalName": "Pavo cristatus", "vernacularName": "Indian Peafowl", "family": "Phasianidae"}
        if params["decimalLongitude"].startswith("77"):
            return {"count": 0}
        if "month" not in params:
            return {"count": 500}
        m = params["month"]
        return {"count": 40, "facets": [{"field": "SPECIES_KEY", "counts": [{"name": "1", "count": m}]}]}


def test_query_bounds_and_filters():
    q = cell_query(Cell(10, 76, 1.0), REGION, SETTINGS, 3)
    assert q["decimalLatitude"] == "10.000000,10.999999"
    assert q["month"] == 3 and q["facet"] == "speciesKey" and q["classKey"] == 212
    assert "month" not in cell_query(Cell(10, 76, 1.0), REGION, SETTINGS, None)


def test_parse_month_response():
    body = {"count": 9, "facets": [{"counts": [{"name": "5", "count": 3}]}]}
    assert parse_month_response(body) == {"count": 9, "species": {"5": 3}}
    assert parse_month_response({"count": 0, "facets": []}) == {"count": 0, "species": {}}


def test_parse_rejects_non_gbif_body():
    with pytest.raises(FetchError):
        parse_month_response({"error": "blocked"})


def test_fetch_skips_empty_cells_and_caches(tmp_path):
    fake = FakeGbif()
    assert fetch_region(REGION, tmp_path, fake, SETTINGS) == ["10_76"]
    first = len(fake.calls)
    assert first == 2 + 12  # two probes, 12 months for the non-empty cell
    fetch_region(REGION, tmp_path, fake, SETTINGS)
    assert len(fake.calls) == first  # all cached

    [cell] = load_raw_cells(tmp_path)
    assert cell.totals == (40,) * 12
    assert cell.species["1"] == tuple(range(1, 13))


def test_species_names(tmp_path):
    fetch_species_names(["1"], tmp_path, FakeGbif())
    assert load_species_names(tmp_path)["1"]["common"] == "Indian Peafowl"


def test_incomplete_cell_is_skipped(tmp_path, caplog):
    d = tmp_path / "cells" / "10_76"
    d.mkdir(parents=True)
    (d / "m01.json").write_text(json.dumps({"count": 1, "species": {}}))
    assert load_raw_cells(tmp_path) == []
    assert "10_76" in caplog.text


def test_missing_raw_dir(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_raw_cells(tmp_path)


@pytest.mark.parametrize(
    "status,retry_after,attempt,expected",
    [
        (429, None, 1, 60.0),
        (429, None, 3, 240.0),
        (429, "300", 1, 300.0),  # server hint wins when longer
        (429, "5", 2, 120.0),  # but never shorter than our own backoff
        (503, None, 10, 900.0),  # capped
        (500, None, 2, 4.0),  # ordinary errors back off in seconds
        (None, None, 1, 2.0),  # network error
        (429, "Wed, 21 Oct 2026 07:28:00 GMT", 1, 60.0),  # date form ignored safely
    ],
)
def test_backoff(status, retry_after, attempt, expected):
    assert backoff_seconds(status, retry_after, attempt) == expected
