"""Command line: `atlas fetch`, `atlas build`, `atlas demo`."""

import argparse
import logging
import sys

from .aggregate import load_raw_cells, load_species_names
from .config import INDIA, OUT_DIR, RAW_DIR, FetchSettings
from .export import SourceInfo, build_bundle, write_bundle

log = logging.getLogger("atlas")

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
    sub.add_parser("build", help="build web/public/data from fetched GBIF data").set_defaults(fn=cmd_build)
    sub.add_parser("demo", help="build web/public/data from SYNTHETIC demo data").set_defaults(fn=cmd_demo)
    args = parser.parse_args(argv)
    try:
        args.fn(args)
    except Exception as exc:  # top-level: report cleanly, non-zero exit
        log.error("%s failed: %s", args.cmd, exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
