"""Worldwide birds: shards, SQL download resume, ingest, names, vectorised classify and the bundle."""

import json
import zipfile

import numpy as np
import pytest

from atlas_pipeline import gbif_sql
from atlas_pipeline.bird_names import resolve_names
from atlas_pipeline.classify import classify, present_months
from atlas_pipeline.classify_vec import LABELS, classify_many
from atlas_pipeline.config import ClassifyRules
from atlas_pipeline.world_bundle import build_world, coverage_manifest
from atlas_pipeline.world_ingest import extract_tsv, ingest_tsv, shard_files, write_shard_meta
from atlas_pipeline.world_shards import SHARDS, shard_by_id, shard_sql


# ---------- shards ----------

def test_shards_tile_the_globe_exactly_once():
    for lat in range(-90, 90):
        for lng in range(-180, 180):
            owners = [s.id for s in SHARDS if s.contains(lat, lng)]
            assert len(owners) == 1, (lat, lng, owners)
    assert shard_by_id("south-asia").contains(28, 77)  # Delhi
    assert SHARDS[0].id == "south-asia" and SHARDS[1].id == "africa"


def test_shard_sql_filters_birds_years_boxes_and_sensitive():
    sql = shard_sql(shard_by_id("south-asia"), sensitive=frozenset({"Ardeotis nigriceps", "O'Brien bird"}))
    assert "\"class\" = 'Aves'" in sql and "occurrencestatus = 'PRESENT'" in sql and "hasgeospatialissues = FALSE" in sql
    assert '"year" >= 2010 AND "year" <= 2026' in sql
    assert "FLOOR(decimallatitude) AS lat0" in sql and "GROUP BY" in sql
    assert "decimallatitude >= 0 AND decimallatitude < 40 AND decimallongitude >= 60 AND decimallongitude < 100" in sql
    assert "species IS NULL OR species NOT IN ('Ardeotis nigriceps', 'O''Brien bird')" in sql
    assert "e-0" not in sql  # fixed-point numbers only
    assert "decimallatitude <= 90" in shard_sql(shard_by_id("europe"))


def test_unknown_shard():
    with pytest.raises(ValueError, match="Unknown shard"):
        shard_by_id("atlantis")


# ---------- SQL download ----------

class FakeGbif:
    def __init__(self, statuses, existing=None, validate_status=201):
        self.statuses, self.existing, self.validate_status = list(statuses), existing or [], validate_status
        self.posts, self.fetched = [], []

    def post(self, url, body):
        self.posts.append(url)
        if url.endswith("/validate"):
            return self.validate_status, "invalid column" if self.validate_status >= 400 else ""
        return 201, "0001-new"

    def get_json(self, url, params=None):
        if "/user/" in url:
            return {"results": self.existing}
        status = self.statuses.pop(0) if len(self.statuses) > 1 else self.statuses[0]
        return {"status": status, "doi": "10.15468/dl.x", "totalRecords": 7, "downloadLink": "https://x/y.zip"}

    def fetch_file(self, url, dest):
        self.fetched.append(url)
        dest.write_bytes(b"zip")


CREDS = gbif_sql.Credentials("u", "p", "e@x")


def test_submit_once_then_resume_from_state(tmp_path):
    http = FakeGbif(["RUNNING"])
    assert gbif_sql.ensure_submitted("SELECT 1", tmp_path, CREDS, http) == "0001-new"
    assert sum(u.endswith("/request") for u in http.posts) == 1
    again = FakeGbif(["RUNNING"])
    assert gbif_sql.ensure_submitted("SELECT 1", tmp_path, CREDS, again) == "0001-new"
    assert again.posts == []  # resumed, nothing resubmitted


def test_reuses_matching_download_from_gbif(tmp_path):
    http = FakeGbif(["RUNNING"], existing=[{"key": "0009-old", "status": "RUNNING", "request": {"sql": "SELECT 1"}}])
    assert gbif_sql.ensure_submitted("SELECT 1", tmp_path, CREDS, http) == "0009-old"
    assert http.posts == []


def test_invalid_sql_is_reported(tmp_path):
    with pytest.raises(gbif_sql.SqlDownloadError, match="rejected"):
        gbif_sql.ensure_submitted("SELECT nope", tmp_path, CREDS, FakeGbif(["RUNNING"], validate_status=400))


def test_wait_times_out_as_still_running_and_fails_cleanly():
    with pytest.raises(gbif_sql.StillRunning):
        gbif_sql.wait_for("k", FakeGbif(["RUNNING"]), max_wait_s=120, poll_s=60, sleep=lambda s: None)
    with pytest.raises(gbif_sql.SqlDownloadError, match="FAILED"):
        gbif_sql.wait_for("k", FakeGbif(["FAILED"]), max_wait_s=120, sleep=lambda s: None)


def test_fetch_download_end_to_end(tmp_path):
    http = FakeGbif(["PREPARING", "RUNNING", "SUCCEEDED"])
    zip_path, info = gbif_sql.fetch_download("SELECT 1", tmp_path, CREDS, http, max_wait_s=10_000, sleep=lambda s: None)
    assert zip_path.name == "0001-new.zip" and info["doi"] == "10.15468/dl.x"
    assert json.loads((tmp_path / "download.json").read_text())["totalRecords"] == 7


def test_credentials_from_env(monkeypatch):
    monkeypatch.delenv("GBIF_USER", raising=False)
    with pytest.raises(gbif_sql.SqlDownloadError, match="GBIF_USER"):
        gbif_sql.Credentials.from_env()


# ---------- ingest ----------

HEADER = "specieskey\tspecies\tfamily\tmonth\tlat0\tlng0\tn"


def _tsv_zip(tmp_path, rows):
    tsv = "\n".join([HEADER, *("\t".join(map(str, r)) for r in rows)]) + "\n"
    z = tmp_path / "dl.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("0001.csv", tsv)
    return z


def _south_asia_rows():
    rows = []
    for m in range(1, 13):
        rows.append(("K1", "Pavo cristatus", "Phasianidae", m, 28.0, 77.0, 50))
        rows.append(("", "", "", m, 28.0, 77.0, 450))  # genus-level: effort only
        if m in (11, 12, 1, 2):
            rows.append(("K2", "Anser indicus", "Anatidae", m, 28.0, 77.0, 40))
        rows.append(("K3", "Ardeotis nigriceps", "Otididae", m, 28.0, 77.0, 3))  # sensitive
        rows.append(("K1", "Pavo cristatus", "Phasianidae", m, 10.0, 76.0, 5))
        rows.append(("K1", "Pavo cristatus", "Phasianidae", m, 50.0, 10.0, 99))  # outside the shard
    return rows


def _ingest(tmp_path, shard_id="south-asia", rows=None):
    work = tmp_path / "work"
    tsv = extract_tsv(_tsv_zip(tmp_path, rows or _south_asia_rows()), tmp_path / "x")
    files = shard_files(work, shard_id)
    meta = ingest_tsv(tsv, shard_by_id(shard_id), files)
    write_shard_meta(files, meta, {"key": "0001", "doi": "10.15468/dl.abc"})
    return work, meta


def test_ingest_pivots_months_and_keeps_effort(tmp_path):
    _, meta = _ingest(tmp_path)
    assert meta["cells"] == 2 and meta["species"] == 2  # sensitive and out-of-shard rows gone
    assert meta["records"] == 12 * (50 + 450 + 3 + 5) + 4 * 40  # sensitive records still count as effort
    import duckdb
    files = shard_files(tmp_path / "work", "south-asia")
    goose = duckdb.sql(f"SELECT c01, c06, c12 FROM '{files.pairs}' WHERE sci = 'Anser indicus'").fetchone()
    assert goose == (40, 0, 40)
    t = duckdb.sql(f"SELECT t01 FROM '{files.totals}' WHERE cell = '28_77'").fetchone()[0]
    assert t == 50 + 450 + 40 + 3


def test_extract_rejects_multi_file_zip(tmp_path):
    z = tmp_path / "two.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("a.csv", "x")
        zf.writestr("b.csv", "y")
    with pytest.raises(ValueError, match="one table"):
        extract_tsv(z, tmp_path / "out")


# ---------- names ----------

def fake_names_http(url, params):
    if url.endswith("/species/212/children"):
        return {"results": [{"key": 729, "rank": "ORDER"}, {"key": 1, "rank": "FAMILY"}]}
    if url.endswith("/species/search"):
        assert params["highertaxonKey"] == 729
        return {"endOfRecords": True, "results": [
            {"key": 2480998, "canonicalName": "Pavo cristatus", "family": "Phasianidae", "order": "Galliformes",
             "vernacularNames": [{"vernacularName": "Paon", "language": "fra"}, {"vernacularName": "Indian Peafowl", "language": "eng"}]}]}
    if url.endswith("/species/match"):
        if params["name"] == "Anser indicus":
            return {"matchType": "EXACT", "usageKey": 2498027, "speciesKey": 2498027, "class": "Aves", "rank": "SPECIES", "family": "Anatidae"}
        return {"matchType": "NONE"}
    if url.endswith("/species/2498027"):
        return {"key": 2498027, "canonicalName": "Anser indicus", "vernacularName": "Bar-headed Goose", "family": "Anatidae"}
    raise AssertionError(url)


def test_names_join_by_scientific_name_and_cache(tmp_path):
    wanted = [("Pavo cristatus", "3X", "Phasianidae"), ("Anser indicus", "4Y", "Anatidae"), ("Avis nova", "5Z", "Novidae")]
    names = resolve_names(wanted, fake_names_http, tmp_path)
    assert names["Pavo cristatus"]["key"] == "2480998" and names["Pavo cristatus"]["common"] == "Indian Peafowl"
    assert names["Anser indicus"]["key"] == "2498027" and names["Anser indicus"]["common"] == "Bar-headed Goose"
    assert names["Avis nova"]["key"] == "5Z" and names["Avis nova"]["family"] == "Novidae"  # kept, never dropped
    again = resolve_names(wanted, lambda u, p: pytest.fail("should be cached"), tmp_path)
    assert again == names
    assert (tmp_path / "checklist-orders" / "729.json").exists()  # per-order cache for resuming


# ---------- vectorised classify ----------

def test_classify_many_matches_classify():
    rng = np.random.default_rng(7)
    n = 3000
    totals = rng.integers(0, 200, size=(n, 12)) * rng.integers(0, 2, size=(n, 12))
    counts = np.minimum(totals, rng.integers(0, 40, size=(n, 12)) * (rng.random((n, 12)) < 0.5))
    rules = ClassifyRules()
    got = classify_many(counts, totals, rules)
    for i in range(n):
        c, t = counts[i].tolist(), totals[i].tolist()
        assert LABELS[got.label[i]] == classify(c, t, rules).value, (c, t)
        assert got.present[i].tolist() == list(present_months(c, t, rules))
    assert set(LABELS[x] for x in got.label) == set(LABELS)  # every label exercised


def test_classify_many_shape_check():
    with pytest.raises(ValueError):
        classify_many(np.zeros((2, 11)), np.zeros((2, 11)))


# ---------- bundle ----------

NAMES = {"Pavo cristatus": {"key": "2480998", "common": "Indian Peafowl", "family": "Phasianidae"},
         "Anser indicus": {"key": "2498027", "common": "Bar-headed Goose", "family": "Anatidae"}}


def test_build_world_bundle_contract(tmp_path):
    work, _ = _ingest(tmp_path)
    out = tmp_path / "bundle"
    summary = build_world(work, NAMES, out)
    assert summary["cells"] == 2 and summary["species"] == 2 and summary["regions"] == ["South Asia"]

    cells = json.loads((out / "cells.json").read_text())
    assert cells["cellSize"] == 1.0 and [c["id"] for c in cells["cells"]] == ["10_76", "28_77"]
    delhi = next(c for c in cells["cells"] if c["id"] == "28_77")
    assert delhi["richness"][0] == 2 and delhi["richness"][5] == 1 and delhi["coverage"][0] == "well"

    detail = json.loads((out / "cells/28_77.json").read_text())
    by_k = {s["k"]: s for s in detail["species"]}
    assert set(by_k) == {"2480998", "2498027"} and by_k["2480998"]["p"] == "resident"
    assert by_k["2498027"]["m"] == [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1] and by_k["2498027"]["p"] == "seasonal"
    assert detail["total"][0] == 543

    rng = json.loads((out / "species/2480998.json").read_text())
    assert set(rng["cells"]) == {"10_76", "28_77"} and rng["cells"]["28_77"]["r"][0] == round(50 / 543, 4)
    index = {s["k"]: s for s in json.loads((out / "species.json").read_text())}
    assert index["2498027"] == {"k": "2498027", "sci": "Anser indicus", "name": "Bar-headed Goose", "family": "Anatidae", "cells": 1}
    assert not any("Ardeotis" in json.dumps(s) for s in index.values())

    meta = json.loads((out / "meta.json").read_text())
    assert meta["source"]["demo"] is False and meta["datasets"] == [{"region": "south-asia", "doi": "10.15468/dl.abc"}]
    cov = json.loads((out / "coverage.json").read_text())
    assert cov["complete"] is False
    assert [r["status"] for r in cov["regions"]] == ["loaded"] + ["pending"] * (len(SHARDS) - 1)
    assert cov["regions"][0]["doi"] == "10.15468/dl.abc"


def test_rebuild_is_idempotent_and_shards_merge(tmp_path):
    work, _ = _ingest(tmp_path)
    out = tmp_path / "bundle"
    build_world(work, NAMES, out)
    second = build_world(work, NAMES, out)
    assert second["changed"] <= 2 and second["removed"] == 0  # at most meta and coverage (timestamps)

    europe = [("K1", "Pavo cristatus", "Phasianidae", m, 50.0, 10.0, 7) for m in range(1, 13)]
    europe += [("", "", "", m, 50.0, 10.0, 93) for m in range(1, 13)]
    (tmp_path / "eu").mkdir()
    _ingest(tmp_path / "eu", "europe", europe)
    for f in (tmp_path / "eu" / "work" / "shards").iterdir():
        f.rename(work / "shards" / f.name)
    merged = build_world(work, NAMES, out)
    assert merged["cells"] == 3 and merged["regions"] == ["South Asia", "Europe and the Middle East"]
    assert set(json.loads((out / "species/2480998.json").read_text())["cells"]) == {"10_76", "28_77", "50_10"}

    for f in (work / "shards").glob("europe*"):
        f.unlink()
    back = build_world(work, NAMES, out)
    assert back["cells"] == 2 and back["removed"] == 1 and not (out / "cells/50_10.json").exists()


def test_build_world_needs_shards(tmp_path):
    with pytest.raises(FileNotFoundError):
        build_world(tmp_path, {}, tmp_path / "out")


def test_coverage_manifest_complete():
    metas = {s.id: {"id": s.id, "ingested": "t", "records": 1, "cells": 1, "species": 1, "download": {"doi": "d"}} for s in SHARDS}
    assert coverage_manifest(metas, "now")["complete"] is True


def test_fresh_ignores_finished_download_but_resumes_running(tmp_path):
    done = [{"key": "0009-old", "status": "SUCCEEDED", "request": {"sql": "SELECT 1"}}]
    assert gbif_sql.ensure_submitted("SELECT 1", tmp_path, CREDS, FakeGbif(["RUNNING"], existing=done), reuse=False) == "0001-new"
    running = [{"key": "0010-run", "status": "RUNNING", "request": {"sql": "SELECT 1"}}]
    assert gbif_sql.ensure_submitted("SELECT 1", tmp_path / "b", CREDS, FakeGbif(["RUNNING"], existing=running), reuse=False) == "0010-run"
