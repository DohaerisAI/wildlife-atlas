"""Place names (L2 product, decision 0010): every GeoNames populated place of 1,000+ people, worldwide.

places/manifest.json   source, licence, fields, counts
places/major.json      places of MAJOR_POP+ people and every capital, loaded up front
places/{x}_{y}.json    the rest, chunked by level-3 tile (22.5 degrees) so the engine loads only what is in view
Row: [name, lng, lat, population, kind, admin1, country]; kind 0 = national capital, 1 = first-order admin seat, 2 = other.
"""

import io
import json
import logging
import zipfile
from dataclasses import dataclass
from pathlib import Path

import requests

from . import tile_math as tm

log = logging.getLogger(__name__)
BASE = "https://download.geonames.org/export/dump/"
CITIES = "cities1000"
MAJOR_POP = 15000
CHUNK_LEVEL = 3
SOURCE = "GeoNames cities1000 (populated places of 1,000+ people) and admin1CodesASCII, download.geonames.org"
LICENSE = "CC BY 4.0, GeoNames (www.geonames.org)"
_KIND = {"PPLC": 0, "PPLA": 1, "PPLG": 1}


@dataclass(frozen=True)
class Place:
    name: str
    lng: float
    lat: float
    population: int
    kind: int
    admin1: str
    country: str

    def row(self) -> list:
        return [self.name, round(self.lng, 4), round(self.lat, 4), self.population, self.kind, self.admin1, self.country]


def parse_admin1(text: str) -> dict[str, str]:
    """'IN.16<TAB>Maharashtra<TAB>...' lines to {'IN.16': 'Maharashtra'}."""
    out = {}
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and parts[0]:
            out[parts[0]] = parts[1]
    return out


def parse_cities(text: str, admin1: dict[str, str]) -> list[Place]:
    """GeoNames dump lines (19 tab-separated fields) to places; malformed lines are skipped and counted."""
    places, bad = [], 0
    for line in text.splitlines():
        f = line.split("\t")
        if len(f) < 19:
            bad += bool(line.strip())
            continue
        try:
            lat, lng, pop = float(f[4]), float(f[5]), int(f[14] or 0)
        except ValueError:
            bad += 1
            continue
        if not (-90 <= lat <= 90 and -180 <= lng <= 180) or not f[1]:
            bad += 1
            continue
        places.append(Place(f[1], lng, lat, pop, _KIND.get(f[7], 2), admin1.get(f"{f[8]}.{f[10]}", ""), f[8]))
    if bad:
        log.warning("skipped %d malformed GeoNames lines", bad)
    return places


def is_major(p: Place) -> bool:
    return p.population >= MAJOR_POP or p.kind == 0


def split(places: list[Place]) -> tuple[list[Place], dict[tuple[int, int], list[Place]]]:
    """Major places (by population, descending) and the rest chunked by level-3 tile, each chunk by population."""
    ordered = sorted(places, key=lambda p: (-p.population, p.name))
    major = [p for p in ordered if is_major(p)]
    chunks: dict[tuple[int, int], list[Place]] = {}
    for p in ordered:
        if not is_major(p):
            _, x, y = tm.tile_at(p.lng, p.lat, CHUNK_LEVEL)
            chunks.setdefault((x, y), []).append(p)
    return major, chunks


def write_places(out: Path, places: list[Place]) -> dict:
    major, chunks = split(places)
    out.mkdir(parents=True, exist_ok=True)
    (out / "major.json").write_text(json.dumps([p.row() for p in major], ensure_ascii=False, separators=(",", ":")))
    for (x, y), rows in chunks.items():
        (out / f"{x}_{y}.json").write_text(json.dumps([p.row() for p in rows], ensure_ascii=False, separators=(",", ":")))
    manifest = {
        "version": 1, "kind": "places", "source": SOURCE, "license": LICENSE,
        "fields": ["name", "lng", "lat", "population", "kind", "admin1", "country"],
        "kinds": {"0": "national capital", "1": "first-order admin seat", "2": "other populated place"},
        "major": {"file": "major.json", "minPopulation": MAJOR_POP, "count": len(major)},
        "chunks": {"level": CHUNK_LEVEL, "file": "{x}_{y}.json", "tiles": sorted(f"{x}_{y}" for x, y in chunks),
                   "count": sum(len(v) for v in chunks.values())},
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    return {"major": len(major), "chunked": manifest["chunks"]["count"], "chunks": len(chunks)}


def fetch(src: Path) -> None:
    src.mkdir(parents=True, exist_ok=True)
    zipped = requests.get(f"{BASE}{CITIES}.zip", timeout=120)
    zipped.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(zipped.content)) as z:
        (src / f"{CITIES}.txt").write_bytes(z.read(f"{CITIES}.txt"))
    admin = requests.get(f"{BASE}admin1CodesASCII.txt", timeout=60)
    admin.raise_for_status()
    (src / "admin1CodesASCII.txt").write_bytes(admin.content)


def build_places(src: Path, out: Path, download: bool = True) -> dict:
    if download:
        fetch(src)
    admin1 = parse_admin1((src / "admin1CodesASCII.txt").read_text(encoding="utf-8"))
    places = parse_cities((src / f"{CITIES}.txt").read_text(encoding="utf-8"), admin1)
    if not places:
        raise ValueError(f"no places parsed from {src}")
    return write_places(out, places)
