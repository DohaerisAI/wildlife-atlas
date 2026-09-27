"""Turn cached raw GBIF responses into per-cell monthly summaries."""

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

from .config import MONTHS

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class CellSummary:
    id: str
    totals: tuple[int, ...]
    species: dict[str, tuple[int, ...]] = field(default_factory=dict)


def summarize_cell(cell_id: str, month_bodies: dict[int, dict]) -> CellSummary:
    totals = tuple(int(month_bodies.get(m, {}).get("count", 0)) for m in range(1, MONTHS + 1))
    keys = {k for body in month_bodies.values() for k in body.get("species", {})}
    species = {
        k: tuple(int(month_bodies.get(m, {}).get("species", {}).get(k, 0)) for m in range(1, MONTHS + 1))
        for k in sorted(keys)
    }
    return CellSummary(cell_id, totals, species)


def load_raw_cells(raw_dir: Path) -> list[CellSummary]:
    cells_dir = raw_dir / "cells"
    if not cells_dir.exists():
        raise FileNotFoundError(f"No raw cell data at {cells_dir}; run the fetch step first")
    summaries, incomplete = [], []
    for cell_dir in sorted(p for p in cells_dir.iterdir() if p.is_dir()):
        bodies = {int(f.stem[1:]): json.loads(f.read_text()) for f in cell_dir.glob("m*.json")}
        if len(bodies) != MONTHS:
            incomplete.append(cell_dir.name)
            continue
        summaries.append(summarize_cell(cell_dir.name, bodies))
    if incomplete:
        log.warning("skipped %d cells with missing months (re-run fetch to complete): %s", len(incomplete), ", ".join(incomplete[:10]))
    return summaries


def load_species_names(raw_dir: Path) -> dict[str, dict]:
    sp_dir = raw_dir / "species"
    if not sp_dir.exists():
        return {}
    return {f.stem: json.loads(f.read_text()) for f in sp_dir.glob("*.json")}
