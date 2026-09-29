import json

from atlas_pipeline.places import MAJOR_POP, Place, parse_admin1, parse_cities, split, write_places


def _line(name, lat, lng, code, cc, a1, pop):
    f = ["1", name, name, "", str(lat), str(lng), "P", code, cc, "", a1, "", "", "", str(pop), "", "", "Asia/Kolkata", "2024-01-01"]
    return "\t".join(f)


ADMIN = "IN.16\tMaharashtra\tMaharashtra\t1264418\nIN.35\tMadhya Pradesh\tMadhya Pradesh\t1264542\n"
CITIES = "\n".join([
    _line("Pune", 18.5196, 73.8554, "PPL", "IN", "16", 3124458),
    _line("Satna", 24.5773, 80.8272, "PPL", "IN", "35", 282977),
    _line("New Delhi", 28.6358, 77.2244, "PPLC", "IN", "07", 317797),
    _line("Amarpatan", 24.3137, 80.9787, "PPL", "IN", "35", 11000),
    "broken\tline",
    _line("Nowhere", 95.0, 10.0, "PPL", "IN", "35", 5000),
])


def test_parse_reads_names_regions_and_kinds():
    places = parse_cities(CITIES, parse_admin1(ADMIN))
    assert [p.name for p in places] == ["Pune", "Satna", "New Delhi", "Amarpatan"]  # broken and off-globe lines skipped
    pune = places[0]
    assert pune.admin1 == "Maharashtra" and pune.country == "IN" and pune.kind == 2
    assert places[2].kind == 0 and places[2].admin1 == ""


def test_split_keeps_big_places_and_capitals_up_front():
    places = parse_cities(CITIES, parse_admin1(ADMIN))
    major, chunks = split(places)
    assert [p.name for p in major] == ["Pune", "New Delhi", "Satna"]
    assert sum(len(v) for v in chunks.values()) == 1 and all(p.population < MAJOR_POP for v in chunks.values() for p in v)


def test_write_places_product(tmp_path):
    summary = write_places(tmp_path, parse_cities(CITIES, parse_admin1(ADMIN)))
    m = json.loads((tmp_path / "manifest.json").read_text())
    assert m["source"] and m["license"].startswith("CC BY") and summary["major"] == 3
    rows = json.loads((tmp_path / "major.json").read_text())
    assert rows[0] == ["Pune", 73.8554, 18.5196, 3124458, 2, "Maharashtra", "IN"]
    tile = m["chunks"]["tiles"][0]
    assert json.loads((tmp_path / f"{tile}.json").read_text())[0][0] == "Amarpatan"


def test_row_rounds_coordinates():
    assert Place("A", 1.234567, -2.345678, 10, 2, "", "XX").row()[1:3] == [1.2346, -2.3457]
