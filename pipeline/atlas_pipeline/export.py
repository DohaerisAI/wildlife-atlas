"""Write the static data bundle the web client reads.

Layout under web/public/data:
  meta.json            source, resolution, demo flag
  cells.json           every cell: monthly bird-record totals, species richness, coverage
  cells/{id}.json      species in one cell: monthly counts, presence label, present-month flags
  species.json         searchable species index
  species/{key}.json   one species' monthly reporting rate and label per cell
"""

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .aggregate import CellSummary
from .global_ranges import GlobalRange
from .classify import classify, coverage, monthly_rates, present_months
from .config import ClassifyRules, CoverageRules

RATE_DIGITS = 4


@dataclass(frozen=True)
class SourceInfo:
    name: str
    url: str
    years: str
    demo: bool
    note: str


def build_bundle(
    cells: list[CellSummary],
    names: dict[str, dict],
    cell_size: float,
    source: SourceInfo,
    classify_rules: ClassifyRules = ClassifyRules(),
    coverage_rules: CoverageRules = CoverageRules(),
    global_ranges: tuple[GlobalRange, ...] = (),
) -> dict[str, object]:
    """Return {relative_path: json_payload}; pure so it can be tested without disk.

    `cells` are the detail region (every species, per-cell lists). `global_ranges` extend featured
    species worldwide; where both cover a cell, the global range wins so one species is measured one way.
    """
    files: dict[str, object] = {}
    names = dict(names)
    index_cells, per_species = [], {}

    for cell in cells:
        if sum(cell.totals) == 0:
            continue
        entries = []
        for key, counts in cell.species.items():
            presence = classify(counts, cell.totals, classify_rules).value
            rates = [round(r, RATE_DIGITS) for r in monthly_rates(counts, cell.totals)]
            months = [int(f) for f in present_months(counts, cell.totals, classify_rules)]
            entries.append({"k": key, "c": list(counts), "p": presence, "m": months})
            per_species.setdefault(key, {})[cell.id] = {"r": rates, "p": presence}
        files[f"cells/{cell.id}.json"] = {"id": cell.id, "total": list(cell.totals), "species": entries}
        index_cells.append(
            {
                "id": cell.id,
                "total": list(cell.totals),
                "richness": [sum(1 for c in cell.species.values() if c[m] > 0) for m in range(12)],
                "coverage": [coverage(t, coverage_rules).value for t in cell.totals],
            }
        )

    for gr in global_ranges:
        names.setdefault(gr.key, gr.name)
        by_cell = per_species.setdefault(gr.key, {})
        for cell_id, (counts, totals) in gr.cells.items():
            rates = [round(r, RATE_DIGITS) for r in monthly_rates(counts, totals)]
            by_cell[cell_id] = {"r": rates, "p": classify(counts, totals, classify_rules).value}

    files["cells.json"] = {"cellSize": cell_size, "cells": index_cells}
    files["species.json"] = [_species_entry(k, names.get(k, {}), per_species[k]) for k in sorted(per_species)]
    for key, by_cell in per_species.items():
        files[f"species/{key}.json"] = {"k": key, "cells": by_cell}
    files["meta.json"] = {
        "source": source.__dict__,
        "resolution": "month",
        "evidence": "recorded-sightings",
        "measure": "share of records of the species' animal class in the cell and month that are this species",
        "coverage": {"detail": "India", "ranges": "worldwide for featured species" if global_ranges else "India"},
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    return files


def _species_entry(key: str, name: dict, by_cell: dict) -> dict:
    return {
        "k": key,
        "sci": name.get("scientific") or key,
        "name": name.get("common") or name.get("scientific") or key,
        "family": name.get("family", ""),
        "cells": len(by_cell),
    }


def write_bundle(files: dict[str, object], out_dir: Path) -> None:
    """Write in place (a running dev server keeps serving the folder) and remove files no longer produced."""
    wanted = {out_dir / rel for rel in files}
    if out_dir.exists():
        for stale in (p for p in out_dir.rglob("*.json") if p not in wanted):
            stale.unlink()
    for rel, payload in files.items():
        path = out_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, separators=(",", ":")))
        tmp.replace(path)
