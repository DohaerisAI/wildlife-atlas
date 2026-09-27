"""Follow featured species worldwide with an adaptive box search on the GBIF occurrence API.

Per species: count records in 20° boxes, subdivide non-empty boxes to 5°, then to 1° cells.
Each 1° cell query also returns a month facet, so one call yields the cell's 12 monthly counts.
Effort baselines (all records of the species' class per cell and month) are fetched once per cell
and shared between species of the same class. Every response is cached so runs resume.
"""

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import MONTHS, SENSITIVE_SPECIES, FetchSettings, GlobalSearch
from .gbif_fetch import API, FetchError, HttpGet, _cached
from .grid import Cell

log = logging.getLogger(__name__)


class SensitiveSpeciesError(ValueError):
    pass


@dataclass(frozen=True)
class Taxon:
    key: str
    scientific: str
    common: str
    class_key: str
    class_name: str
    family: str


def resolve_taxon(name: str, raw_dir: Path, http_get: HttpGet) -> Taxon:
    if name in SENSITIVE_SPECIES:
        raise SensitiveSpeciesError(f"{name} is poaching-sensitive; fine-resolution ranges are not fetched")
    slug = name.lower().replace(" ", "_")
    body = _cached(raw_dir / "match" / f"{slug}.json", lambda: http_get(f"{API}/species/match", {"name": name, "kingdom": "Animalia"}))
    key = body.get("speciesKey") or body.get("usageKey")
    if not key or body.get("matchType") == "NONE" or not body.get("classKey"):
        raise FetchError(f"GBIF could not match species {name!r}: {body.get('matchType', 'no result')}")
    return Taxon(
        key=str(key), scientific=body.get("canonicalName") or name, common=body.get("vernacularName") or "",
        class_key=str(body["classKey"]), class_name=body.get("class", ""), family=body.get("family", ""),
    )


def box_params(lat0: float, lng0: float, size: float, settings: FetchSettings) -> dict[str, Any]:
    eps = 1e-6
    lat1 = min(90.0, lat0 + size) - eps
    lng1 = min(180.0, lng0 + size) - eps
    return {
        "occurrenceStatus": "PRESENT",
        "hasGeospatialIssue": "false",
        "year": settings.year_range,
        "decimalLatitude": f"{lat0},{lat1}",
        "decimalLongitude": f"{lng0},{lng1}",
        "limit": 0,
    }


def world_boxes(size: int) -> Iterator[tuple[int, int]]:
    for lat in range(-90, 90, size):
        for lng in range(-180, 180, size):
            yield lat, lng


def sub_boxes(lat0: int, lng0: int, size: int, child: int) -> Iterator[tuple[int, int]]:
    for lat in range(lat0, min(90, lat0 + size), child):
        for lng in range(lng0, min(180, lng0 + size), child):
            yield lat, lng


def parse_month_facet(body: dict[str, Any]) -> list[int]:
    if "count" not in body:
        raise FetchError(f"Unexpected GBIF response, no 'count': {str(body)[:200]}")
    months = [0] * MONTHS
    for facet in body.get("facets") or []:
        for entry in facet.get("counts", []):
            m = int(entry["name"])
            if 1 <= m <= MONTHS:
                months[m - 1] = int(entry["count"])
    return months


def _monthly(filters: dict[str, Any], lat: int, lng: int, settings: FetchSettings, http_get: HttpGet) -> list[int]:
    params = box_params(lat, lng, 1, settings) | filters | {"facet": "month", "facetLimit": MONTHS}
    return parse_month_facet(http_get(f"{API}/occurrence/search", params))


def fetch_species_cells(taxon: Taxon, raw_dir: Path, http_get: HttpGet, settings: FetchSettings, search: GlobalSearch = GlobalSearch()) -> dict[str, list[int]]:
    """Return {cell_id: 12 monthly counts} for every 1° cell with records of the taxon."""
    base = raw_dir / "species" / taxon.key
    frontier = list(world_boxes(search.levels[0]))
    for size, child in zip(search.levels, search.levels[1:]):
        keep = []
        for lat, lng in frontier:
            body = _cached(base / f"L{size}" / f"{lat}_{lng}.json",
                           lambda la=lat, ln=lng, s=size: {"count": http_get(f"{API}/occurrence/search", box_params(la, ln, s, settings) | {"taxonKey": taxon.key})["count"]})
            if body["count"] > 0:
                keep.extend(sub_boxes(lat, lng, size, child))
        log.info("%s: %d boxes at %d° have records", taxon.scientific, len(keep) // max(1, (size // child) ** 2), size)
        frontier = keep

    cells: dict[str, list[int]] = {}
    for lat, lng in frontier:
        body = _cached(base / "L1m" / f"{lat}_{lng}.json",
                       lambda la=lat, ln=lng: {"months": _monthly({"taxonKey": taxon.key}, la, ln, settings, http_get)})
        if sum(body["months"]) > 0:
            cells[Cell(lat, lng, 1.0).id] = body["months"]
    return cells


def fetch_class_totals(class_key: str, cell_ids: list[str], raw_dir: Path, http_get: HttpGet, settings: FetchSettings) -> dict[str, list[int]]:
    totals = {}
    for cell_id in cell_ids:
        lat, lng = (int(float(v)) for v in cell_id.split("_"))
        body = _cached(raw_dir / "class" / class_key / f"{cell_id}.json",
                       lambda la=lat, ln=lng: {"months": _monthly({"classKey": class_key}, la, ln, settings, http_get)})
        totals[cell_id] = body["months"]
    return totals
