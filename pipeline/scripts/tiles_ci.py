"""Detail tile pyramid in CI (decision 0010, docs/plans/one-engine.md). Three steps, one per workflow job:

  tiles_ci.py plan  --bbox W,S,E,N                     -> JSON list of land shards ("3/x/y") for the job matrix
  tiles_ci.py shard OUT --shard 3/x/y --level L        -> land/ and ndvi/ tiles for levels 5..L of one shard (Earth Engine)
  tiles_ci.py merge DIR --level L [--bbox ...]         -> manifest.json with the availability index of what is in DIR
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from atlas_pipeline import tile_math as tm
from atlas_pipeline.tile_product import DETAIL_SOURCES, manifest, scan, write_manifest, write_shard
from atlas_pipeline.tiles_ee_fine import FINE_FROM_LEVEL
from atlas_pipeline.tiles_ee_fine import SOURCES as FINE

PACK_LAND = Path(__file__).resolve().parents[2] / "web/public/content/living-earth/v2/land.png"
MIN_LEVEL = 5
SITE_LEVEL = 9


def land_mask() -> np.ndarray:
    return np.asarray(Image.open(PACK_LAND))[..., 0] > 0


def bbox(text: str) -> tm.Bounds:
    w, s, e, n = (float(v) for v in text.split(","))
    return w, s, e, n


def cmd_plan(args) -> int:
    if args.sites.strip():
        shards = sorted({"/".join(map(str, t)) for b in tm.site_boxes(args.sites, SITE_LEVEL) for t in tm.tiles_in_bbox(args.shard_level, b)})
        if args.only.strip():
            only = {"/".join(map(str, tm.parse_tile(s))) for s in args.only.split(",") if s.strip()}
            shards = [s for s in shards if s in only]
        print(json.dumps(shards))
        logging.info("%d site shards", len(shards))
        return 0
    shards = [f"{z}/{x}/{y}" for z, x, y in tm.plan_shards(land_mask(), bbox(args.bbox), args.shard_level)]
    if args.only.strip():
        only = {"/".join(map(str, tm.parse_tile(s))) for s in args.only.split(",") if s.strip()}
        shards = [s for s in shards if s in only]
    print(json.dumps(shards))
    logging.info("%d shards", len(shards))
    return 0


def cmd_shard(args) -> int:
    import ee

    from atlas_pipeline.tiles_ee import pull_shard

    key = os.environ["EE_SERVICE_ACCOUNT_KEY"]
    ee.Initialize(ee.ServiceAccountCredentials(json.loads(key)["client_email"], key_data=key), project=os.environ["EE_PROJECT"],
                  opt_url="https://earthengine-highvolume.googleapis.com")
    shard = tm.parse_tile(args.shard)
    boxes = tm.site_boxes(args.sites, SITE_LEVEL) if args.sites.strip() else None
    keep = (lambda t: tm.inside_any(t, boxes)) if boxes else None
    exact = {'auto': None, 'yes': True, 'no': False}[args.exact]
    mosaic = pull_shard(ee, shard, args.level, land_mask(), workers=args.workers, keep=keep, exact=exact)
    # site runs write only whole site tiles (level 9 and finer); world runs write the full pyramid from level 5
    written = write_shard(Path(args.out), mosaic, max(shard[0], SITE_LEVEL if boxes else MIN_LEVEL))
    size = sum(s for _, s in written)
    summary = {"shard": args.shard, "level": args.level, "tiles": len(written), "bytes": size}
    (Path(args.out) / f"shard-{shard[0]}-{shard[1]}-{shard[2]}.json").write_text(json.dumps(summary))
    logging.info("shard done: %s", summary)
    return 0


def cmd_merge(args) -> int:
    root = Path(args.dir)
    present = scan(root)
    lo = min(present) if present else MIN_LEVEL
    sources, rgb = fine_sources(args.level, root)
    m = manifest(args.name, (lo, args.level), present, ndvi=True, sources=sources, bounds=bbox(args.bbox), rgb=rgb)
    m["regions"] = [{**json.loads(p.read_text()), "levels": [lo, args.level]} for p in sorted(root.glob("shard-*.json"))]
    write_manifest(root, m)
    logging.info("manifest: %s", m["counts"])
    return 0


def fine_sources(level: int, root: Path) -> tuple[dict, dict | None]:
    fine = level >= FINE_FROM_LEVEL
    sources = {**DETAIL_SOURCES, **({"hillshade": FINE["shade"], "ndvi": FINE["ndvi"]} if fine else {})}
    rgb = {"source": FINE["rgb"], "license": FINE["rgb_license"]} if fine and (root / "rgb").exists() else None
    return sources, rgb


def cmd_absorb(args) -> int:
    from atlas_pipeline.tile_absorb import absorb, rebuild_manifest

    served = Path(args.served)
    for d in args.shard_dirs:
        logging.info("absorbed %s", absorb(served, Path(d)))
    sources, rgb = fine_sources(args.level, served)
    m = rebuild_manifest(served, args.name, sources, rgb)
    logging.info("manifest %s: %s, %d regions", args.name, m["counts"], len(m["regions"]))
    return 0


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", stream=sys.stderr)
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--bbox", default="-180,-90,180,90")
    p.add_argument("--only", default="", help="comma-separated shards to keep")
    p.add_argument("--sites", default="", help="'lng,lat;lng,lat': validation sites instead of the bbox")
    p.add_argument("--shard-level", type=int, default=3)
    p.set_defaults(fn=cmd_plan)
    s = sub.add_parser("shard")
    s.add_argument("out")
    s.add_argument("--shard", required=True)
    s.add_argument("--level", type=int, default=8)
    s.add_argument("--workers", type=int, default=8)
    s.add_argument("--sites", default="")
    s.add_argument("--exact", choices=("auto", "yes", "no"), default="auto", help="WorldCover mode from 10 m pixels (slow) or its mode pyramid")
    s.set_defaults(fn=cmd_shard)
    g = sub.add_parser("merge")
    g.add_argument("dir")
    g.add_argument("--level", type=int, default=8)
    g.add_argument("--bbox", default="-180,-90,180,90")
    g.add_argument("--name", default="detail")
    g.set_defaults(fn=cmd_merge)
    a = sub.add_parser("absorb", help="merge finished shard folders into a served tileset (replaces only those shards)")
    a.add_argument("served")
    a.add_argument("shard_dirs", nargs="+")
    a.add_argument("--name", default="detail")
    a.add_argument("--level", type=int, default=8)
    a.set_defaults(fn=cmd_absorb)
    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
