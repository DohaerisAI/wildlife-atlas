"""Fetch per-cell, per-month bird species counts from the GBIF occurrence search API.

Each response is cached under data/raw/gbif so an interrupted run resumes where it stopped.
Run this on a network that can reach api.gbif.org.
"""

import json
import logging
import time
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

import requests

from .config import AVES_CLASS_KEY, MONTHS, FetchSettings, Region
from .grid import Cell, region_cells

log = logging.getLogger(__name__)

API = "https://api.gbif.org/v1"
USER_AGENT = "wildlife-atlas-prototype/0.1 (noncommercial research prototype)"

HttpGet = Callable[[str, dict[str, Any]], dict[str, Any]]


class FetchError(RuntimeError):
    pass


def make_http_get(settings: FetchSettings) -> HttpGet:
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    def get(url: str, params: dict[str, Any]) -> dict[str, Any]:
        for attempt in range(1, settings.retries + 1):
            try:
                resp = session.get(url, params=params, timeout=settings.timeout_s)
                if resp.status_code == 200 and "json" in resp.headers.get("Content-Type", ""):
                    time.sleep(settings.request_delay_s)
                    return resp.json()
                reason = f"HTTP {resp.status_code}: {resp.text[:200].strip()!r} for {resp.url}"
            except (requests.RequestException, ValueError) as exc:
                reason = str(exc)
            log.warning("GBIF request failed (attempt %d/%d): %s", attempt, settings.retries, reason)
            time.sleep(2**attempt)
        raise FetchError(f"GBIF request to {url} failed after {settings.retries} attempts: {reason}")

    return get


BOUND_EPS = 1e-6


def coord_range(lo: float, hi: float) -> str:
    """GBIF range "lo,hi" with the upper edge nudged inside, in fixed-point (never '-1e-06', which GBIF rejects)."""
    return f"{lo:.6f},{hi - BOUND_EPS:.6f}"


def cell_query(cell: Cell, region: Region, settings: FetchSettings, month: int | None) -> dict[str, Any]:
    params: dict[str, Any] = {
        "country": region.country,
        "classKey": AVES_CLASS_KEY,
        "occurrenceStatus": "PRESENT",
        "hasGeospatialIssue": "false",
        "year": settings.year_range,
        "decimalLatitude": coord_range(cell.lat0, cell.lat0 + cell.size),
        "decimalLongitude": coord_range(cell.lng0, cell.lng0 + cell.size),
        "limit": 0,
    }
    if month is not None:
        params |= {"month": month, "facet": "speciesKey", "facetLimit": settings.facet_limit}
    return params


def parse_month_response(body: dict[str, Any]) -> dict[str, Any]:
    if "count" not in body:
        raise FetchError(f"Unexpected GBIF response, no 'count': {str(body)[:200]}")
    facets = body.get("facets") or []
    counts = facets[0]["counts"] if facets else []
    return {"count": int(body["count"]), "species": {str(f["name"]): int(f["count"]) for f in counts}}


def fetch_region(
    region: Region,
    raw_dir: Path,
    http_get: HttpGet,
    settings: FetchSettings,
    cells: Iterable[Cell] | None = None,
) -> list[str]:
    """Probe each cell, then fetch 12 monthly facet queries for cells that have bird records."""
    fetched = []
    for cell in cells if cells is not None else region_cells(region):
        probe_path = raw_dir / "probe" / f"{cell.id}.json"
        probe = _cached(probe_path, lambda: {"count": http_get(f"{API}/occurrence/search", cell_query(cell, region, settings, None))["count"]})
        if probe["count"] == 0:
            continue
        for month in range(1, MONTHS + 1):
            path = raw_dir / "cells" / cell.id / f"m{month:02d}.json"
            _cached(path, lambda m=month: parse_month_response(http_get(f"{API}/occurrence/search", cell_query(cell, region, settings, m))))
        fetched.append(cell.id)
        log.info("cell %s done (%d records)", cell.id, probe["count"])
    return fetched


def fetch_species_names(keys: Iterable[str], raw_dir: Path, http_get: HttpGet) -> None:
    for key in keys:
        path = raw_dir / "species" / f"{key}.json"
        _cached(path, lambda k=key: _species_record(http_get(f"{API}/species/{k}", {})))


def _species_record(body: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": str(body.get("key", "")),
        "scientific": body.get("canonicalName") or body.get("scientificName", ""),
        "common": body.get("vernacularName") or "",
        "family": body.get("family") or "",
        "order": body.get("order") or "",
    }


def _cached(path: Path, produce: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    if path.exists():
        return json.loads(path.read_text())
    data = produce()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.replace(path)
    return data
