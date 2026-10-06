"""Build the detail shards the served tileset is missing, from this machine, one at a time (resumable).

Each missing level-3 land shard is pulled at level 8 (tiles_ee.pull_shard, the same code the CI matrix runs),
written as levels 5-8 into a staging folder, absorbed into the served tileset right away, recorded under shards/
(so a restart skips it), and given its true colour straight away (tiles_rgb), so the map never shows a finished
area in class colours. Login: the machine's gcloud application-default credentials (coast_ee.initialize).

  uv run --with earthengine-api python scripts/fill_shards.py [--only 3/x/y,...] [--workers 6]
"""

import argparse
import json
import logging
import shutil
import sys
from pathlib import Path

from atlas_pipeline import tile_math as tm
from atlas_pipeline.tile_absorb import absorb, rebuild_manifest
from atlas_pipeline.tile_product import DETAIL_SOURCES, write_shard
from atlas_pipeline.tiles_rgb import LICENSE as RGB_LICENSE
from atlas_pipeline.tiles_rgb import SOURCE as RGB_SOURCE

sys.path.insert(0, str(Path(__file__).parent))
from tiles_ci import MIN_LEVEL, land_mask  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
SERVED = REPO / "web/public/content/tiles/detail"
WORLD = REPO / "web/public/content/tiles/world"
# keep the true-colour entry on every rebuild: without it the engine shows class colours at levels 5-8
RGB = {"source": RGB_SOURCE, "license": RGB_LICENSE}
STAGING = REPO / "data/staging"
LEVEL = 8


def missing_shards(served: Path) -> list[tm.Tile]:
    done = {p.stem for p in (served / "shards").glob("*.json")}
    return [s for s in tm.plan_shards(land_mask(), (-180.0, -90.0, 180.0, 90.0), 3) if f"{s[0]}-{s[1]}-{s[2]}" not in done]


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma-separated shards z/x/y")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--exact", choices=("yes", "no"), default="no",
                    help="WorldCover class from its 10 m pixels (yes: 'Object too large' splits, days) or its mode pyramid (no)")
    args = ap.parse_args()
    import ee

    from atlas_pipeline.coast_ee import initialize
    from atlas_pipeline.tiles_ee import pull_shard
    from atlas_pipeline.tiles_rgb import pull_and_derive

    initialize(ee)
    colour = lambda keep: pull_and_derive(ee, SERVED, WORLD, workers=3, groups=4, keep=keep, log=logging.info)  # noqa: E731
    rebuild_manifest(SERVED, "detail", DETAIL_SOURCES, RGB)  # catch up: shards absorbed before this ran
    colour(None)  # and colour for any tiles that have none yet (re-adds the manifest's rgb entry)
    todo = missing_shards(SERVED)
    if args.only.strip():
        only = {tm.parse_tile(s) for s in args.only.split(",") if s.strip()}
        todo = [s for s in todo if s in only]
    logging.info("fill: %d missing shards", len(todo))
    mask = land_mask()
    for i, shard in enumerate(todo, 1):
        sid = f"{shard[0]}-{shard[1]}-{shard[2]}"
        out = STAGING / sid
        shutil.rmtree(out, ignore_errors=True)
        mosaic = pull_shard(ee, shard, LEVEL, mask, workers=args.workers, exact=args.exact == "yes")
        written = write_shard(out, mosaic, max(shard[0], MIN_LEVEL))
        summary = {"shard": "/".join(map(str, shard)), "level": LEVEL, "tiles": len(written), "bytes": sum(s for _, s in written)}
        (out / f"shard-{sid}.json").write_text(json.dumps(summary))
        absorb(SERVED, out)
        shutil.rmtree(out, ignore_errors=True)
        rebuild_manifest(SERVED, "detail", DETAIL_SOURCES, RGB)  # the engine only draws tiles the manifest lists
        colour(lambda t, s=shard: tm.ancestor(t, s[0]) == s)  # and re-adds the manifest's rgb entry
        logging.info("fill: shard %d/%d %s done, %d tiles; overall", i, len(todo), summary["shard"], summary["tiles"])
    logging.info("fill: done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
