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


def test_profiles_all_covers_species_list_plus_featured(monkeypatch):
    from atlas_pipeline import profiles
    from atlas_pipeline.config import FEATURED_SPECIES

    seen = {}
    monkeypatch.setattr(profiles, "make_get_json", lambda: None)
    monkeypatch.setattr(profiles, "write_profiles", lambda species, out, get, refresh: seen.update(species=species, refresh=refresh) or [])
    assert cli.main(["profiles", "--all", "--refresh"]) == 0
    names = [s["sci"] for s in seen["species"]]
    assert seen["refresh"] is True and len(names) == len(set(names)) > 1000
    assert set(FEATURED_SPECIES) <= set(names)
    assert cli.main(["profiles"]) == 0
    assert [s["sci"] for s in seen["species"]] == list(FEATURED_SPECIES) and seen["refresh"] is False
