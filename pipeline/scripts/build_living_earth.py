"""Build the Living Earth globe pack in CI: Earth Engine computes, we pack and upload as an artifact.

usage: build_living_earth.py OUT_DIR [--pack v1|v2]   (v2 = v1's layers plus ocean, land and relief)
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

import ee

from atlas_pipeline.living_earth import compute_months, write_pack


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", default="living-earth")
    ap.add_argument("--pack", choices=("v1", "v2"), default="v1")
    args = ap.parse_args()
    key = os.environ["EE_SERVICE_ACCOUNT_KEY"]
    ee.Initialize(ee.ServiceAccountCredentials(json.loads(key)["client_email"], key_data=key), project=os.environ["EE_PROJECT"])
    out = Path(args.out)
    if args.pack == "v1":
        surface, climate = compute_months(ee)
        manifest = write_pack(out, surface, climate)
        print("pack v1 written:", manifest["surface"]["month"], manifest["climate"]["month"])
        return 0

    from atlas_pipeline.living_earth_v2 import write_pack_v2
    from atlas_pipeline.living_earth_v2_ee import compute_land, compute_ocean, compute_relief

    relief = compute_relief(ee)
    land = compute_land(ee)
    ocean = compute_ocean(ee)
    surface, climate = compute_months(ee)
    manifest = write_pack_v2(out, surface, climate, ocean, land, relief)
    sizes = {name: (out / manifest[name]["file"]).stat().st_size for name in ("surface", "climate", "ocean", "land", "relief")}
    print("pack v2 written:", sizes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
