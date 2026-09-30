"""Command line: `atlas fetch`, `atlas build`, `atlas demo`."""

import argparse
import logging
import sys
from pathlib import Path

from .aggregate import load_raw_cells, load_species_names
from .config import INDIA, OUT_DIR, RAW_DIR, REPO_ROOT, FetchSettings
from .export import SourceInfo, build_bundle, write_bundle

log = logging.getLogger("atlas")
WEB_ROOT = REPO_ROOT / "web"
STILL_RUNNING = 3  # exit code: a GBIF download is accepted but not finished; re-run to resume

GBIF_SOURCE = SourceInfo(
    name="GBIF occurrence records (includes eBird, iNaturalist and others)",
    url="https://www.gbif.org/occurrence/search?country=IN&taxon_key=212",
    years=FetchSettings().year_range.replace(",", "–"),
    demo=False,
    note="Record share per 1° cell and month. Reflects where people report birds, not population size.",
)
DEMO_SOURCE = SourceInfo(
    name="SYNTHETIC DEMO DATA",
    url="",
    years="n/a",
    demo=True,
    note="Invented seasonal patterns for interface development. Not evidence of any real occurrence.",
)


def cmd_fetch(args: argparse.Namespace) -> None:
    from .gbif_fetch import fetch_region, fetch_species_names, make_http_get
    from .grid import parse_cell_id

    settings = FetchSettings()
    http_get = make_http_get(settings)
    cells = [parse_cell_id(c.strip(), INDIA.cell_deg) for c in args.cells.split(",")] if args.cells else None
    fetched = fetch_region(INDIA, RAW_DIR / "gbif", http_get, settings, cells=cells)
    log.info("fetched %d cells; resolving species names", len(fetched))
    keys = {k for cell in load_raw_cells(RAW_DIR / "gbif") for k in cell.species}
    fetch_species_names(sorted(keys), RAW_DIR / "gbif", http_get)
    log.info("done: %d species", len(keys))


def cmd_fetch_global(args: argparse.Namespace) -> None:
    from .config import FEATURED_SPECIES
    from .gbif_fetch import make_http_get
    from .global_ranges import fetch_global

    settings = FetchSettings()
    names = tuple(args.species) if args.species else FEATURED_SPECIES
    done = fetch_global(RAW_DIR / "gbif", make_http_get(settings), settings, names)
    log.info("fetched worldwide ranges for %d featured species", len(done))


def cmd_world_sql(args: argparse.Namespace) -> None:
    from .world_shards import shard_by_id, shard_sql

    print(shard_sql(shard_by_id(args.shard)))


def cmd_world_shard(args: argparse.Namespace) -> None:
    """Download one region shard from GBIF (resumable) and ingest it into parquet tables."""
    import json

    from .gbif_sql import Credentials, RequestsTransport, fetch_download, validate
    from .world_ingest import extract_tsv, ingest_tsv, shard_files, write_shard_meta
    from .world_shards import shard_by_id, shard_sql

    shard, work = shard_by_id(args.shard), Path(args.work)
    state_dir = work / "downloads" / shard.id
    if args.validate_only:
        creds = Credentials.from_env()
        validate(shard_sql(shard), creds, RequestsTransport(creds))
        log.info("GBIF accepts the SQL for shard %s", shard.id)
        return
    if args.tsv:
        tsv, download = Path(args.tsv), {}
    else:
        creds = Credentials.from_env()
        zip_path, _ = fetch_download(shard_sql(shard), state_dir, creds, RequestsTransport(creds), args.max_wait_min * 60,
                                     reuse=not args.fresh)
        tsv = extract_tsv(zip_path, state_dir / "tsv")
        download = json.loads((state_dir / "download.json").read_text())
    files = shard_files(work, shard.id)
    meta = write_shard_meta(files, ingest_tsv(tsv, shard, files), download)
    log.info("shard %s ingested: %s", shard.id, {k: meta[k] for k in ("records", "rows", "species", "cells", "pairs")})


def _shard_species(work: Path) -> list[tuple[str, str | None, str | None]]:
    import duckdb

    glob = str(work / "shards" / "*-pairs.parquet")
    return duckdb.sql(f"SELECT sci, MIN(specieskey), MIN(family) FROM read_parquet('{glob}') GROUP BY sci ORDER BY sci").fetchall()


def cmd_world_names(args: argparse.Namespace) -> None:
    from .bird_names import resolve_names
    from .gbif_fetch import make_http_get

    work = Path(args.work)
    names = resolve_names(_shard_species(work), make_http_get(FetchSettings()), work)
    log.info("names: %d species, %d with English names", len(names), sum(1 for n in names.values() if n.get("common")))


def cmd_world_build(args: argparse.Namespace) -> None:
    import json

    from .world_bundle import build_world

    work = Path(args.work)
    names_path = work / "names.json"
    names = json.loads(names_path.read_text()) if names_path.exists() else {}
    if not names:
        log.warning("no %s; species keep their scientific names as keys (run `atlas world-names`)", names_path)
    build_world(work, names, Path(args.out))


def cmd_profiles(args: argparse.Namespace) -> None:
    import json

    from .config import FEATURED_SPECIES, REPO_ROOT
    from .profiles import make_get_json, write_profiles

    species: list[dict] = [{"sci": s} for s in FEATURED_SPECIES]
    if args.all:
        path = Path(args.species_json) if args.species_json else REPO_ROOT / "web" / "public" / "data" / "species.json"
        listed = json.loads(path.read_text())
        known = {s["sci"] for s in listed}
        species = [*listed, *(s for s in species if s["sci"] not in known)]
    out = REPO_ROOT / "web" / "public" / "content" / "profiles"
    done = write_profiles(species, out, make_get_json(), refresh=args.refresh)
    log.info("wrote %d species profiles", len(done))


def cmd_build(_: argparse.Namespace) -> None:
    from .global_ranges import load_global_ranges

    raw = RAW_DIR / "gbif"
    ranges = tuple(load_global_ranges(raw))
    files = build_bundle(load_raw_cells(raw), load_species_names(raw), INDIA.cell_deg, GBIF_SOURCE, global_ranges=ranges)
    write_bundle(files, OUT_DIR)
    log.info("wrote %d files to %s", len(files), OUT_DIR)


def cmd_demo(_: argparse.Namespace) -> None:
    from .demo import demo_cells, demo_names
    from .demo_world import demo_world_ranges

    cells = demo_cells()
    world = demo_world_ranges(exclude={c.id for c in cells})
    files = build_bundle(cells, demo_names(), INDIA.cell_deg, DEMO_SOURCE, global_ranges=world)
    write_bundle(files, OUT_DIR)
    log.info("wrote %d SYNTHETIC demo files to %s", len(files), OUT_DIR)


def cmd_tiles_world(args: argparse.Namespace) -> None:
    import numpy as np
    from PIL import Image

    from .tile_product import manifest, scan, write_manifest, write_world

    root = Path(args.out)
    land = np.asarray(Image.open(Path(args.pack) / "land.png").convert("RGB"))
    written = write_world(root, land, range(0, 5))
    write_manifest(root, manifest("world", (0, 4), scan(root), ndvi=False))
    log.info("world tiles: %d files, %.1f MB in %s", len(written), sum(s for _, s in written) / 1e6, root)


def cmd_coast_plan(args: argparse.Namespace) -> None:
    import json

    from .coast_mask import PLAN_PATH, coastal_tiles, plan_payload
    from .coast_patch import census

    present, water, ocean = census(Path(args.tiles), args.level)
    tiles = coastal_tiles(args.level, present, water, ocean)
    PLAN_PATH.write_text(json.dumps(plan_payload(args.level, tiles), indent=1) + "\n")
    log.info("coast plan: %d of %d level-%d tiles (%d with water) -> %s", len(tiles), len(present), args.level, len(water), PLAN_PATH)


def cmd_coast_patch(args: argparse.Namespace) -> None:
    from .coast_patch import patch_tileset
    from .tile_math import parse_bbox

    bbox = parse_bbox(args.bbox) if args.bbox else None
    backup = Path(args.backup) if args.backup else None
    summary = patch_tileset(Path(args.tiles), Path(args.coast), args.level, args.min_level, bbox, backup, log=log.info)
    log.info("coast patch: %s", summary)


def cmd_places(args: argparse.Namespace) -> None:
    from .places import build_places

    summary = build_places(Path(args.src), Path(args.out), download=not args.offline)
    log.info("places: %s", summary)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(prog="atlas", description="Wildlife Atlas data pipeline")
    sub = parser.add_subparsers(dest="cmd", required=True)
    fetch = sub.add_parser("fetch", help="download GBIF monthly counts for India (needs api.gbif.org access)")
    fetch.add_argument("--cells", help="comma-separated cell ids to fetch instead of all of India, e.g. 10_76,28_77")
    fetch.set_defaults(fn=cmd_fetch)
    fetch_global = sub.add_parser("fetch-global", help="follow featured species worldwide on GBIF (needs api.gbif.org access)")
    fetch_global.add_argument("--species", action="append", help="scientific name; repeatable. Default: FEATURED_SPECIES")
    fetch_global.set_defaults(fn=cmd_fetch_global)
    profiles = sub.add_parser("profiles", help="fetch species profiles (photos, size, status) from Wikidata/Wikipedia/Commons")
    profiles.add_argument("--all", action="store_true", help="every species in web/public/data/species.json, not only FEATURED_SPECIES")
    profiles.add_argument("--species-json", help="species index for --all (default web/public/data/species.json), "
                          "e.g. data/world/bundle/species.json for every bird worldwide")
    profiles.add_argument("--refresh", action="store_true", help="refetch species whose profile file already exists")
    profiles.set_defaults(fn=cmd_profiles)
    world_dir = REPO_ROOT / "data" / "world"
    w_sql = sub.add_parser("world-sql", help="print the GBIF SQL for one worldwide bird shard")
    w_sql.add_argument("--shard", required=True)
    w_sql.set_defaults(fn=cmd_world_sql)
    w_shard = sub.add_parser("world-shard", help="download (resumable) and ingest one worldwide bird shard (needs GBIF secrets)")
    w_shard.add_argument("--shard", required=True, help="region id from world_shards.SHARDS, e.g. africa")
    w_shard.add_argument("--work", default=str(world_dir))
    w_shard.add_argument("--max-wait-min", type=float, default=300.0, help="stop waiting on GBIF after this; re-run resumes")
    w_shard.add_argument("--fresh", action="store_true", help="submit a new download even if GBIF has a finished one of this query")
    w_shard.add_argument("--validate-only", action="store_true", help="only ask GBIF whether the shard's SQL is valid")
    w_shard.add_argument("--tsv", help="ingest this already downloaded TSV instead of fetching")
    w_shard.set_defaults(fn=cmd_world_shard)
    w_names = sub.add_parser("world-names", help="resolve keys, English names and families for ingested shards (needs api.gbif.org)")
    w_names.add_argument("--work", default=str(world_dir))
    w_names.set_defaults(fn=cmd_world_names)
    w_build = sub.add_parser("world-build", help="build the worldwide bird bundle from ingested shards")
    w_build.add_argument("--work", default=str(world_dir))
    w_build.add_argument("--out", default=str(world_dir / "bundle"))
    w_build.set_defaults(fn=cmd_world_build)
    sub.add_parser("build", help="build web/public/data from fetched GBIF data").set_defaults(fn=cmd_build)
    sub.add_parser("demo", help="build web/public/data from SYNTHETIC demo data").set_defaults(fn=cmd_demo)
    tiles_world = sub.add_parser("tiles-world", help="cut Living Earth world tiles (levels 0-4) from pack v2")
    tiles_world.add_argument("--pack", default=str(WEB_ROOT / "public/content/living-earth/v2"))
    tiles_world.add_argument("--out", default=str(WEB_ROOT / "public/content/tiles/world"))
    tiles_world.set_defaults(fn=cmd_tiles_world)
    detail = WEB_ROOT / "public/content/tiles/detail"
    coast_plan = sub.add_parser("coast-plan", help="list the coastal tiles of a tileset into assets/coast-plan.json (for coast.yml)")
    coast_plan.add_argument("--tiles", default=str(detail))
    coast_plan.add_argument("--level", type=int, default=8)
    coast_plan.set_defaults(fn=cmd_coast_plan)
    coast_patch = sub.add_parser("coast-patch", help="turn near-shore water into ocean in served tiles from the coast mask")
    coast_patch.add_argument("--tiles", default=str(detail))
    coast_patch.add_argument("--coast", default=str(REPO_ROOT / "data" / "coast"))
    coast_patch.add_argument("--level", type=int, default=8, help="mask level (the tileset's finest)")
    coast_patch.add_argument("--min-level", type=int, default=5, help="re-derive coarser tiles down to this level")
    coast_patch.add_argument("--bbox", help="only masks inside W,S,E,N (for trying it on one place first)")
    coast_patch.add_argument("--backup", default=str(REPO_ROOT / "data" / "coast-backup"), help="copy originals here first ('' = none)")
    coast_patch.set_defaults(fn=cmd_coast_patch)
    places = sub.add_parser("places", help="build the place-name product from GeoNames cities1000 (downloads it)")
    places.add_argument("--src", default=str(RAW_DIR / "geonames"))
    places.add_argument("--out", default=str(WEB_ROOT / "public/content/places"))
    places.add_argument("--offline", action="store_true", help="use files already in --src")
    places.set_defaults(fn=cmd_places)
    args = parser.parse_args(argv)
    from .gbif_sql import StillRunning

    try:
        args.fn(args)
    except StillRunning as exc:
        log.warning("%s", exc)
        return STILL_RUNNING
    except Exception as exc:  # top-level: report cleanly, non-zero exit
        log.error("%s failed: %s", args.cmd, exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
