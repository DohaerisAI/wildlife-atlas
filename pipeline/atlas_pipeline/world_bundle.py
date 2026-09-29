"""Build the worldwide bird bundle from every ingested shard, in the same layout the atlas already reads.

Deterministic and idempotent: the bundle is rebuilt from the shard tables on disk, so re-running one
shard replaces only that shard's contribution. Files whose bytes do not change are not rewritten, and
files no longer produced are removed. Adds `coverage.json`, the manifest of which regions are loaded.
"""

import json
import logging
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import numpy as np

from .classify import coverage
from .classify_vec import LABELS, classify_many
from .config import SENSITIVE_SPECIES, ClassifyRules, CoverageRules, FetchSettings
from .world_ingest import C_COLS, T_COLS
from .world_shards import SHARDS

log = logging.getLogger(__name__)

RATE_DIGITS = 4
SOURCE = {
    "name": "GBIF occurrence records (includes eBird, iNaturalist and others)",
    "url": "https://www.gbif.org/occurrence/search?taxon_key=212",
    "years": FetchSettings().year_range.replace(",", "–"),
    "demo": False,
    "note": "Record share per 1° cell and month. Reflects where people report birds, not population size.",
}


@dataclass
class BundleWriter:
    """Writes JSON files under `root`, skipping unchanged ones, and removes stale files at the end."""
    root: Path
    written: set[Path] = field(default_factory=set)
    changed: int = 0
    bytes: int = 0

    def write(self, rel: str, payload: object) -> None:
        path = self.root / rel
        data = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
        self.written.add(path)
        self.bytes += len(data)
        if path.exists() and path.stat().st_size == len(data) and path.read_bytes() == data:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)
        self.changed += 1

    def finish(self) -> int:
        stale = [p for p in self.root.rglob("*.json") if p not in self.written] if self.root.exists() else []
        for p in stale:
            p.unlink()
        return len(stale)


def _load(con: duckdb.DuckDBPyConnection, shards_dir: Path, names: dict[str, dict], sensitive: frozenset[str]) -> None:
    rows = [(sci, str(r["key"]), r.get("common") or "", r.get("family") or "") for sci, r in names.items() if sci not in sensitive]
    con.execute("CREATE TABLE names (sci VARCHAR, key VARCHAR, common VARCHAR, family VARCHAR)")
    if rows:
        con.executemany("INSERT INTO names VALUES (?, ?, ?, ?)", rows)
    pairs_glob, totals_glob = str(shards_dir / "*-pairs.parquet"), str(shards_dir / "*-totals.parquet")
    csum = ", ".join(f"SUM(p.{c})::BIGINT AS {c}" for c in C_COLS)
    # Unnamed species keep their scientific name as key; sensitive ones are dropped (decision 0007).
    con.execute(
        f"CREATE TABLE pairs AS SELECT COALESCE(n.key, p.sci) AS key, p.cell, {csum} "
        f"FROM read_parquet('{pairs_glob}') p LEFT JOIN names n USING (sci) "
        f"WHERE p.sci NOT IN (SELECT UNNEST(?::VARCHAR[])) GROUP BY 1, 2", [sorted(sensitive)])
    tsum = ", ".join(f"SUM({t})::BIGINT AS {t}" for t in T_COLS)
    con.execute(f"CREATE TABLE totals AS SELECT cell, {tsum} FROM read_parquet('{totals_glob}') GROUP BY cell HAVING {' + '.join(f'SUM({t})' for t in T_COLS)} > 0")
    con.execute("CREATE TABLE ce AS SELECT cell, (ROW_NUMBER() OVER (ORDER BY cell) - 1)::INTEGER AS ci FROM totals")
    con.execute("CREATE TABLE sp AS SELECT key, (ROW_NUMBER() OVER (ORDER BY key) - 1)::INTEGER AS si FROM (SELECT DISTINCT key FROM pairs)")


def _arrays(con: duckdb.DuckDBPyConnection) -> dict[str, np.ndarray]:
    cols = ", ".join([*(f"p.{c}" for c in C_COLS), *(f"t.{c}" for c in T_COLS)])
    got = con.execute(
        f"SELECT ce.ci, sp.si, {cols} FROM pairs p JOIN totals t USING (cell) JOIN ce USING (cell) JOIN sp USING (key) "
        "ORDER BY ce.ci, sp.si").fetchnumpy()
    return {
        "ci": np.asarray(got["ci"], dtype=np.int32), "si": np.asarray(got["si"], dtype=np.int32),
        "counts": np.stack([np.asarray(got[c], dtype=np.int64) for c in C_COLS], axis=1),
        "totals": np.stack([np.asarray(got[c], dtype=np.int64) for c in T_COLS], axis=1),
    }


def _groups(sorted_ids: np.ndarray) -> Iterator[tuple[int, int, int]]:
    """(id, start, stop) for runs of equal ids in a sorted array."""
    if sorted_ids.size == 0:
        return
    edges = np.flatnonzero(np.diff(sorted_ids)) + 1
    starts = np.concatenate([[0], edges])
    stops = np.concatenate([edges, [sorted_ids.size]])
    for a, b in zip(starts.tolist(), stops.tolist()):
        yield int(sorted_ids[a]), a, b


def _cell_files(w: BundleWriter, a: dict, cls, cells: list[str], keys: list[str], cell_totals: np.ndarray, rules: CoverageRules) -> list[dict]:
    index, done = [], set()
    present_any = a["counts"] > 0
    for ci, lo, hi in _groups(a["ci"]):
        total = cell_totals[ci].tolist()
        counts, months, labels = a["counts"][lo:hi].tolist(), cls.present[lo:hi].astype(np.int8).tolist(), cls.label[lo:hi].tolist()
        species = [{"k": keys[s], "c": c, "p": LABELS[p], "m": m} for s, c, p, m in zip(a["si"][lo:hi].tolist(), counts, labels, months)]
        w.write(f"cells/{cells[ci]}.json", {"id": cells[ci], "total": total, "species": species})
        index.append(_index_entry(cells[ci], total, present_any[lo:hi].sum(axis=0).tolist(), rules))
        done.add(ci)
    for ci in sorted(set(range(len(cells))) - done):  # cells with bird records but none named to species
        total = cell_totals[ci].tolist()
        w.write(f"cells/{cells[ci]}.json", {"id": cells[ci], "total": total, "species": []})
        index.append(_index_entry(cells[ci], total, [0] * 12, rules))
    return sorted(index, key=lambda e: e["id"])


def _index_entry(cell_id: str, total: list[int], richness: list[int], rules: CoverageRules) -> dict:
    return {"id": cell_id, "total": total, "richness": richness, "coverage": [coverage(t, rules).value for t in total]}


def _species_files(w: BundleWriter, a: dict, cls, cells: list[str], keys: list[str]) -> dict[int, int]:
    order = np.argsort(a["si"], kind="stable")
    si, ci = a["si"][order], a["ci"][order]
    rates, labels = np.round(cls.rates[order], RATE_DIGITS), cls.label[order]
    n_cells = {}
    for s, lo, hi in _groups(si):
        by_cell = {cells[c]: {"r": r, "p": LABELS[p]} for c, r, p in zip(ci[lo:hi].tolist(), rates[lo:hi].tolist(), labels[lo:hi].tolist())}
        w.write(f"species/{keys[s]}.json", {"k": keys[s], "cells": by_cell})
        n_cells[s] = hi - lo
    return n_cells


def coverage_manifest(shard_metas: dict[str, dict], generated: str) -> dict:
    regions = []
    for s in SHARDS:
        m = shard_metas.get(s.id)
        base = {"id": s.id, "name": s.name, "boxes": [list(b) for b in s.boxes]}
        if m:
            dl = m.get("download") or {}
            regions.append({**base, "status": "loaded", "built": m.get("ingested"), "records": m.get("records"),
                            "cells": m.get("cells"), "species": m.get("species"), "doi": dl.get("doi")})
        else:
            regions.append({**base, "status": "pending"})
    return {"version": 1, "generated": generated, "cellSize": 1.0, "complete": all(r["status"] == "loaded" for r in regions), "regions": regions}


def build_world(work: Path, names: dict[str, dict], out_dir: Path, classify_rules: ClassifyRules = ClassifyRules(),
                coverage_rules: CoverageRules = CoverageRules(), sensitive: frozenset[str] = SENSITIVE_SPECIES) -> dict:
    shards_dir = work / "shards"
    metas = {json.loads(p.read_text())["id"]: json.loads(p.read_text()) for p in sorted(shards_dir.glob("*.json"))}
    if not metas:
        raise FileNotFoundError(f"No ingested shards in {shards_dir}; run `atlas world-shard` first")
    con = duckdb.connect()
    _load(con, shards_dir, names, sensitive)
    cells = [r[0] for r in con.execute("SELECT cell FROM ce ORDER BY ci").fetchall()]
    keys = [r[0] for r in con.execute("SELECT key FROM sp ORDER BY si").fetchall()]
    tcols = ", ".join(T_COLS)
    cell_totals = np.array(con.execute(f"SELECT {tcols} FROM totals JOIN ce USING (cell) ORDER BY ci").fetchall(), dtype=np.int64).reshape(-1, 12)
    a = _arrays(con)
    info = {k: (common, family) for k, common, family in con.execute("SELECT key, FIRST(common ORDER BY sci), FIRST(family ORDER BY sci) FROM names GROUP BY key").fetchall()}
    sci_of = dict(con.execute("SELECT key, MIN(sci) FROM names GROUP BY key").fetchall())
    con.close()

    cls = classify_many(a["counts"], a["totals"], classify_rules)
    w = BundleWriter(out_dir)
    index = _cell_files(w, a, cls, cells, keys, cell_totals, coverage_rules)
    n_cells = _species_files(w, a, cls, cells, keys)
    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    manifest = coverage_manifest(metas, generated)
    loaded = [r["name"] for r in manifest["regions"] if r["status"] == "loaded"]
    w.write("cells.json", {"cellSize": 1.0, "cells": index})
    w.write("species.json", [
        {"k": k, "sci": sci_of.get(k, k), "name": info.get(k, ("", ""))[0] or sci_of.get(k, k), "family": info.get(k, ("", ""))[1], "cells": n_cells[s]}
        for s, k in enumerate(keys)])
    w.write("coverage.json", manifest)
    w.write("meta.json", {
        "source": SOURCE, "resolution": "month", "evidence": "recorded-sightings",
        "measure": "share of records of the species' animal class in the cell and month that are this species",
        "coverage": {"detail": "worldwide" if manifest["complete"] else ", ".join(loaded), "ranges": "all bird species in loaded regions"},
        "datasets": [{"region": r["id"], "doi": r["doi"]} for r in manifest["regions"] if r.get("doi")],
        "generated": generated,
    })
    removed = w.finish()
    summary = {"regions": loaded, "cells": len(index), "species": len(keys), "species_cells": int(a["ci"].size),
               "files": len(w.written), "changed": w.changed, "removed": removed, "bytes": w.bytes}
    log.info("world bundle: %s", summary)
    return summary
