"""Turn one shard's GBIF SQL download (a zipped TSV) into two small parquet tables with DuckDB.

  {shard}-pairs.parquet   sci, specieskey, family, cell, c01..c12   one row per species and cell
  {shard}-totals.parquet  cell, t01..t12                            all bird records per cell-month

Rows without a species (genus-level records) only add to totals. Rows outside the shard's boxes
(and sensitive species, as a second guard) are dropped so shards never overlap.
"""

import json
import logging
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from .config import MONTHS, SENSITIVE_SPECIES
from .world_shards import Shard

log = logging.getLogger(__name__)

C_COLS = [f"c{m:02d}" for m in range(1, MONTHS + 1)]
T_COLS = [f"t{m:02d}" for m in range(1, MONTHS + 1)]


@dataclass(frozen=True)
class ShardFiles:
    pairs: Path
    totals: Path
    meta: Path


def shard_files(work: Path, shard_id: str) -> ShardFiles:
    d = work / "shards"
    return ShardFiles(d / f"{shard_id}-pairs.parquet", d / f"{shard_id}-totals.parquet", d / f"{shard_id}.json")


def extract_tsv(zip_path: Path, dest_dir: Path) -> Path:
    with zipfile.ZipFile(zip_path) as zf:
        names = [n for n in zf.namelist() if not n.endswith("/")]
        if len(names) != 1:
            raise ValueError(f"Expected one table in {zip_path.name}, found {names}")
        dest_dir.mkdir(parents=True, exist_ok=True)
        return Path(zf.extract(names[0], dest_dir))


def _in_shard_sql(shard: Shard) -> str:
    return " OR ".join(f"(lat0 >= {a} AND lat0 < {b} AND lng0 >= {c} AND lng0 < {d})" for a, b, c, d in shard.boxes)


def _pivot(cols: list[str]) -> str:
    return ", ".join(f"COALESCE(SUM(n) FILTER (WHERE month = {m}), 0)::BIGINT AS {c}" for m, c in enumerate(cols, 1))


def ingest_tsv(tsv: Path, shard: Shard, out: ShardFiles, sensitive: frozenset[str] = SENSITIVE_SPECIES) -> dict:
    """Write the shard's parquet tables and a small meta file; return the meta."""
    out.pairs.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute(
        "CREATE TEMP TABLE raw AS SELECT "
        "NULLIF(TRIM(specieskey), '') AS specieskey, NULLIF(TRIM(species), '') AS sci, NULLIF(TRIM(family), '') AS family, "
        "CAST(\"month\" AS INTEGER) AS month, "
        "LEAST(89, GREATEST(-90, CAST(FLOOR(CAST(lat0 AS DOUBLE)) AS INTEGER))) AS lat0, "
        "LEAST(179, GREATEST(-180, CAST(FLOOR(CAST(lng0 AS DOUBLE)) AS INTEGER))) AS lng0, "
        "CAST(n AS BIGINT) AS n "
        "FROM read_csv(?, delim='\t', header=true, quote='', escape='', all_varchar=true)",
        [str(tsv)],
    )
    con.execute(f"DELETE FROM raw WHERE month NOT BETWEEN 1 AND {MONTHS} OR NOT ({_in_shard_sql(shard)})")
    if sensitive:
        con.execute("UPDATE raw SET sci = NULL, specieskey = NULL, family = NULL WHERE sci IN (SELECT UNNEST(?))", [sorted(sensitive)])
    cell = "CAST(lat0 AS VARCHAR) || '_' || CAST(lng0 AS VARCHAR)"
    con.execute(
        f"COPY (SELECT sci, MIN(specieskey) AS specieskey, MIN(family) AS family, {cell} AS cell, {_pivot(C_COLS)} "
        f"FROM raw WHERE sci IS NOT NULL GROUP BY sci, lat0, lng0 ORDER BY sci, cell) TO '{out.pairs}' (FORMAT parquet)"
    )
    con.execute(
        f"COPY (SELECT {cell} AS cell, {_pivot(T_COLS)} FROM raw GROUP BY lat0, lng0 ORDER BY cell) "
        f"TO '{out.totals}' (FORMAT parquet)"
    )
    records, rows = con.execute("SELECT COALESCE(SUM(n), 0), COUNT(*) FROM raw").fetchone()
    pairs, species = con.execute(f"SELECT COUNT(*), COUNT(DISTINCT sci) FROM '{out.pairs}'").fetchone()
    cells = con.execute(f"SELECT COUNT(*) FROM '{out.totals}'").fetchone()[0]
    con.close()
    meta = {"id": shard.id, "name": shard.name, "boxes": [list(b) for b in shard.boxes], "records": int(records),
            "rows": int(rows), "pairs": int(pairs), "species": int(species), "cells": int(cells),
            "ingested": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    log.info("%s: %d rows, %d records, %d species, %d cells, %d species-cells", shard.id, rows, records, species, cells, pairs)
    return meta


def write_shard_meta(out: ShardFiles, meta: dict, download: dict) -> dict:
    full = {**meta, "download": {k: download.get(k) for k in ("key", "doi", "totalRecords", "size", "created")}}
    out.meta.write_text(json.dumps(full, indent=1))
    return full
