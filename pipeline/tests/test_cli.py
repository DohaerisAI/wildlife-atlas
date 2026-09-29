from atlas_pipeline import cli


def test_demo_command_writes_bundle(tmp_path, monkeypatch):
    monkeypatch.setattr(cli, "OUT_DIR", tmp_path / "data")
    assert cli.main(["demo"]) == 0
    assert (tmp_path / "data" / "meta.json").exists()
    assert (tmp_path / "data" / "species" / "demo-falamu.json").exists()


def test_build_without_raw_data_fails_cleanly(tmp_path, monkeypatch):
    monkeypatch.setattr(cli, "RAW_DIR", tmp_path / "raw")
    monkeypatch.setattr(cli, "OUT_DIR", tmp_path / "data")
    assert cli.main(["build"]) == 1


def test_fetch_passes_cell_list(monkeypatch):
    seen = {}
    monkeypatch.setattr(cli, "cmd_fetch", lambda args: seen.update(cells=args.cells))
    assert cli.main(["fetch", "--cells", "10_76,28_77"]) == 0
    assert seen["cells"] == "10_76,28_77"


def test_fetch_global_species_flag_is_repeatable(monkeypatch):
    seen = {}
    monkeypatch.setattr(cli, "cmd_fetch_global", lambda args: seen.update(species=args.species))
    assert cli.main(["fetch-global", "--species", "Falco amurensis", "--species", "Anser indicus"]) == 0
    assert seen["species"] == ["Falco amurensis", "Anser indicus"]


def test_profiles_all_covers_species_list_plus_featured(monkeypatch, tmp_path):
    import json

    from atlas_pipeline import config, profiles
    from atlas_pipeline.config import FEATURED_SPECIES

    # a small species list of our own: the real one is built data, not in git
    listed = [{"k": str(i), "sci": f"Testus species{i}", "name": f"Test {i}", "family": "Testidae", "cells": 1} for i in range(3)]
    listed.append({"k": "dup", "sci": FEATURED_SPECIES[0], "name": "", "family": "", "cells": 1})
    data = tmp_path / "web" / "public" / "data"
    data.mkdir(parents=True)
    (data / "species.json").write_text(json.dumps(listed))
    monkeypatch.setattr(config, "REPO_ROOT", tmp_path)

    seen = {}
    monkeypatch.setattr(profiles, "make_get_json", lambda: None)
    monkeypatch.setattr(profiles, "write_profiles", lambda species, out, get, refresh: seen.update(species=species, refresh=refresh) or [])
    assert cli.main(["profiles", "--all", "--refresh"]) == 0
    names = [s["sci"] for s in seen["species"]]
    assert seen["refresh"] is True and len(names) == len(set(names))
    assert {"Testus species0", "Testus species2"} <= set(names)
    assert set(FEATURED_SPECIES) <= set(names)
    assert cli.main(["profiles"]) == 0
    assert [s["sci"] for s in seen["species"]] == list(FEATURED_SPECIES) and seen["refresh"] is False
    world = tmp_path / "world.json"
    world.write_text(json.dumps([{"k": "9", "sci": "Avis mundi", "name": "", "family": "", "cells": 1}]))
    assert cli.main(["profiles", "--all", "--species-json", str(world)]) == 0
    assert "Avis mundi" in [s["sci"] for s in seen["species"]] and "Testus species0" not in [s["sci"] for s in seen["species"]]


def test_world_shard_and_build_from_local_tsv(tmp_path):
    import json

    tsv = tmp_path / "dl.csv"
    rows = ["specieskey\tspecies\tfamily\tmonth\tlat0\tlng0\tn"]
    rows += [f"K1\tPavo cristatus\tPhasianidae\t{m}\t28.0\t77.0\t50\n\t\t\t{m}\t28.0\t77.0\t450" for m in range(1, 13)]
    tsv.write_text("\n".join(rows) + "\n")
    work, out = tmp_path / "work", tmp_path / "out"
    assert cli.main(["world-shard", "--shard", "south-asia", "--work", str(work), "--tsv", str(tsv)]) == 0
    assert cli.main(["world-build", "--work", str(work), "--out", str(out)]) == 0
    species = json.loads((out / "species.json").read_text())
    assert [s["sci"] for s in species] == ["Pavo cristatus"] and species[0]["k"] == "Pavo cristatus"  # no names yet
    assert json.loads((out / "coverage.json").read_text())["regions"][0]["status"] == "loaded"
    assert cli.main(["world-shard", "--shard", "nowhere", "--work", str(work), "--tsv", str(tsv)]) == 1


def test_world_shard_waiting_exits_resumable(monkeypatch, tmp_path):
    from atlas_pipeline import gbif_sql

    def still(*a, **k):
        raise gbif_sql.StillRunning("still RUNNING")
    monkeypatch.setenv("GBIF_USER", "u")
    monkeypatch.setenv("GBIF_PASSWORD", "p")
    monkeypatch.setenv("GBIF_EMAIL", "e")
    monkeypatch.setattr(gbif_sql, "fetch_download", still)
    assert cli.main(["world-shard", "--shard", "africa", "--work", str(tmp_path)]) == cli.STILL_RUNNING
