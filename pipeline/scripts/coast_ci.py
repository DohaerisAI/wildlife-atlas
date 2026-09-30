"""Coast mask in CI (docs/sessions/2026-09-30-handoff.md). Three steps, one per workflow job:

  coast_ci.py plan                         -> JSON list of level-3 shards holding planned coastal tiles
  coast_ci.py shard OUT --shard 3/x/y      -> sea/{z}/{x}/{y}.png masks for the shard's planned tiles (Earth Engine)
  coast_ci.py merge DIR                    -> manifest.json of the masks in DIR

The tiles come from assets/coast-plan.json, written on the dev machine from the served tiles (`atlas coast-plan`).
"""

import argparse
import json
import logging
import sys
from pathlib import Path

from atlas_pipeline import coast_mask as cm
from atlas_pipeline import tile_math as tm


def cmd_plan(args) -> int:
    level, tiles = cm.read_plan()
    shards = ["/".join(map(str, s)) for s in cm.plan_shards(level, tiles, args.shard_level)]
    if args.only.strip():
        only = {"/".join(map(str, tm.parse_tile(s))) for s in args.only.split(",") if s.strip()}
        shards = [s for s in shards if s in only]
    print(json.dumps(shards))
    logging.info("%d coastal tiles in %d shards", len(tiles), len(shards))
    return 0


def cmd_shard(args) -> int:
    import ee

    from atlas_pipeline.coast_ee import initialize, pull_masks

    initialize(ee)
    shard = tm.parse_tile(args.shard)
    level, planned = cm.read_plan()
    todo = sorted((level, x, y) for x, y in planned if tm.ancestor((level, x, y), shard[0]) == shard)
    out = Path(args.out)
    masks = pull_masks(ee, todo, workers=args.workers, floor_level=shard[0])
    size = sum(cm.write_mask(out, t, m) for t, m in masks.items())
    summary = {"shard": args.shard, "level": level, "planned": len(todo), "tiles": len(masks), "bytes": size}
    (out / f"coast-{shard[0]}-{shard[1]}-{shard[2]}.json").write_text(json.dumps(summary))
    logging.info("shard done: %s", summary)
    return 0


def cmd_merge(args) -> int:
    _, planned = cm.read_plan()
    m = cm.write_manifest(Path(args.dir), len(planned))
    logging.info("coast manifest: %s of %d planned", m["counts"], len(planned))
    return 0


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", stream=sys.stderr)
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--only", default="", help="comma-separated shards to keep")
    p.add_argument("--shard-level", type=int, default=3)
    p.set_defaults(fn=cmd_plan)
    s = sub.add_parser("shard")
    s.add_argument("out")
    s.add_argument("--shard", required=True)
    s.add_argument("--workers", type=int, default=4)
    s.set_defaults(fn=cmd_shard)
    m = sub.add_parser("merge")
    m.add_argument("dir")
    m.set_defaults(fn=cmd_merge)
    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
