"""Build worldwide species ranges (counts plus class effort per cell) from fetched or synthetic data."""

import json
import logging
from dataclasses import dataclass
from pathlib import Path

from .config import FEATURED_SPECIES, FetchSettings
from .gbif_fetch import HttpGet, _cached
from .gbif_global import SensitiveSpeciesError, fetch_class_totals, fetch_species_cells, resolve_taxon

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class GlobalRange:
    key: str
    name: dict
    # cell_id -> (species counts, class totals), 12 months each
    cells: dict[str, tuple[tuple[int, ...], tuple[int, ...]]]


def fetch_global(raw_dir: Path, http_get: HttpGet, settings: FetchSettings, names: tuple[str, ...] = FEATURED_SPECIES) -> list[str]:
    done = []
    for name in names:
        try:
            taxon = resolve_taxon(name, raw_dir, http_get)
        except SensitiveSpeciesError as exc:
            log.warning("skipping: %s", exc)
            continue
        cells = fetch_species_cells(taxon, raw_dir, http_get, settings)
        totals = fetch_class_totals(taxon.class_key, sorted(cells), raw_dir, http_get, settings)
        _cached(raw_dir / "ranges" / f"{taxon.key}.json", lambda t=taxon, c=cells, tt=totals: {
            "key": t.key,
            "name": {"key": t.key, "scientific": t.scientific, "common": t.common, "family": t.family, "class": t.class_name},
            "cells": {cid: [c[cid], tt[cid]] for cid in c},
        })
        log.info("%s: %d cells worldwide", taxon.scientific, len(cells))
        done.append(taxon.key)
    return done


def load_global_ranges(raw_dir: Path) -> list[GlobalRange]:
    ranges_dir = raw_dir / "ranges"
    if not ranges_dir.exists():
        return []
    out = []
    for f in sorted(ranges_dir.glob("*.json")):
        body = json.loads(f.read_text())
        cells = {cid: (tuple(pair[0]), tuple(pair[1])) for cid, pair in body["cells"].items()}
        out.append(GlobalRange(body["key"], body["name"], cells))
    return out
