"""English names, families and stable keys for bird species, joined by scientific name (decision 0002).

SQL downloads carry the new backbone's species keys; the atlas (and gbif.org species pages) use the
backbone's integer keys. So names are resolved from the GBIF backbone checklist of class Aves (paged
species search, ~a few dozen calls), then per-name `species/match` for the leftovers. Results are kept
in one JSON cache so every re-run only asks about names it has not seen. Unresolvable names keep the
SQL key so no species is ever dropped for lack of a name.
"""

import json
import logging
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from .config import AVES_CLASS_KEY
from .gbif_fetch import API, HttpGet

log = logging.getLogger(__name__)

BACKBONE = "d7dddbf4-2cf0-4f39-9b2a-bb099caae36c"
PAGE = 300  # smaller pages: large ones with every vernacular name time out
ENGLISH = ("eng", "en")


def english_name(result: dict[str, Any]) -> str:
    for v in result.get("vernacularNames") or []:
        if v.get("language") in ENGLISH and v.get("vernacularName"):
            return v["vernacularName"]
    return ""


def name_record(result: dict[str, Any], common: str = "") -> dict[str, str]:
    return {
        "key": str(result.get("acceptedKey") or result.get("speciesKey") or result.get("key") or result.get("usageKey") or ""),
        "scientific": result.get("canonicalName") or result.get("scientificName", ""),
        "common": common or english_name(result) or result.get("vernacularName") or "",
        "family": result.get("family") or "",
        "order": result.get("order") or "",
    }


def bird_orders(http_get: HttpGet) -> list[int]:
    """Keys of the backbone's orders under class Aves (each is paged on its own: deep offsets are very slow)."""
    body = http_get(f"{API}/species/{AVES_CLASS_KEY}/children", {"limit": 200})
    return [int(r["key"]) for r in body.get("results", []) if r.get("rank") == "ORDER"]


def _checklist_page_through(http_get: HttpGet, higher: int) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    offset = 0
    while True:
        body = http_get(f"{API}/species/search", {
            "datasetKey": BACKBONE, "highertaxonKey": higher, "rank": "SPECIES",
            "status": "ACCEPTED", "limit": PAGE, "offset": offset,
        })
        for r in body.get("results", []):
            rec = name_record(r)
            if rec["scientific"] and rec["key"]:
                out.setdefault(rec["scientific"], rec)
        offset += PAGE
        if body.get("endOfRecords", True) or not body.get("results"):
            return out


def fetch_checklist(http_get: HttpGet, cache: Path) -> dict[str, dict[str, str]]:
    """Every accepted bird species in the backbone: canonical name -> record.

    Paged one order at a time, each order cached under `cache`'s folder, so an interrupted run resumes.
    """
    if cache.exists():
        return json.loads(cache.read_text())
    parts = cache.parent / "checklist-orders"
    out: dict[str, dict[str, str]] = {}
    for order in bird_orders(http_get):
        part = parts / f"{order}.json"
        if part.exists():
            got = json.loads(part.read_text())
        else:
            got = _checklist_page_through(http_get, order)
            _save(part, got)
        out.update({k: v for k, v in got.items() if k not in out})
        log.info("checklist: %d species after order %d", len(out), order)
    _save(cache, out)
    return out


def match_name(sci: str, http_get: HttpGet) -> dict[str, str] | None:
    body = http_get(f"{API}/species/match", {"name": sci, "class": "Aves", "kingdom": "Animalia", "strict": "true"})
    if body.get("matchType") in (None, "NONE") or body.get("class") != "Aves" or body.get("rank") not in ("SPECIES", "SUBSPECIES"):
        return None
    key = body.get("acceptedUsageKey") or body.get("speciesKey") or body.get("usageKey")
    detail = http_get(f"{API}/species/{key}", {}) if key else {}
    return {**name_record({**body, **detail}), "key": str(key)} if key else None


def resolve_names(wanted: Iterable[tuple[str, str | None, str | None]], http_get: HttpGet, work: Path) -> dict[str, dict[str, str]]:
    """{sci: record} for (sci, sql_key, sql_family) triples. Cached in work/names.json, resumable."""
    cache_path = work / "names.json"
    cache: dict[str, dict[str, str]] = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    checklist = fetch_checklist(http_get, work / "aves-checklist.json")
    todo = [(s, k, f) for s, k, f in wanted if s not in cache]
    log.info("names: %d cached, %d new", len(cache), len(todo))
    for i, (sci, sql_key, sql_family) in enumerate(todo, 1):
        rec = checklist.get(sci) or match_name(sci, http_get)
        if rec is None:
            rec = {"key": sql_key or sci, "scientific": sci, "common": "", "family": sql_family or "", "order": "", "unmatched": "1"}
        cache[sci] = {**rec, "scientific": sci, "family": rec.get("family") or sql_family or ""}
        if i % 50 == 0:
            _save(cache_path, cache)
            log.info("names: %d/%d resolved", i, len(todo))
    _save(cache_path, cache)
    return cache


def _save(path: Path, cache: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False))
    tmp.replace(path)
