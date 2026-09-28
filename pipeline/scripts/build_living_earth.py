"""Build the Living Earth globe pack in CI: Earth Engine computes, we pack and upload as an artifact."""

import json
import logging
import os
import sys
from pathlib import Path

import ee

from atlas_pipeline.living_earth import compute_months, write_pack


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    key = os.environ["EE_SERVICE_ACCOUNT_KEY"]
    ee.Initialize(ee.ServiceAccountCredentials(json.loads(key)["client_email"], key_data=key), project=os.environ["EE_PROJECT"])
    surface, climate = compute_months(ee)
    manifest = write_pack(Path(sys.argv[1] if len(sys.argv) > 1 else "living-earth"), surface, climate)
    print("pack written:", manifest["surface"]["month"], manifest["climate"]["month"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
