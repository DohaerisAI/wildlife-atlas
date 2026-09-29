"""Probe Earth Engine from CI: login, dataset access, a point sample and a small global pixel pull."""

import json
import os
import sys

import ee


def main() -> int:
    key = os.environ["EE_SERVICE_ACCOUNT_KEY"]
    creds = ee.ServiceAccountCredentials(json.loads(key)["client_email"], key_data=key)
    ee.Initialize(creds, project=os.environ["EE_PROJECT"])
    print("login: ok")

    gsw = ee.Image("JRC/GSW1_4/GlobalSurfaceWater")
    print("surface water bands:", gsw.bandNames().getInfo())
    era = ee.ImageCollection("ECMWF/ERA5_LAND/MONTHLY_AGGR").filterDate("2023-10-01", "2023-11-01").first()
    print("ERA5-Land bands (first 8):", era.bandNames().getInfo()[:8])

    doyang = ee.Geometry.Point([94.2, 26.2])
    print("Doyang water occurrence %:", gsw.select("occurrence").reduceRegion(ee.Reducer.first(), doyang, 30).getInfo())

    grid = {"dimensions": {"width": 360, "height": 180}, "crsCode": "EPSG:4326",
            "affineTransform": {"scaleX": 1, "shearX": 0, "translateX": -180, "shearY": 0, "scaleY": -1, "translateY": 90}}
    arr = ee.data.computePixels({"expression": gsw.select("occurrence").unmask(0), "fileFormat": "NUMPY_NDARRAY", "grid": grid})
    print("global 1° pull:", arr.shape, arr.dtype, "| cells with any water:", int((arr["occurrence"] > 0).sum()))
    if "v2" in sys.argv[1:]:
        from ee_probe_v2 import probe_v2
        probe_v2()
    elif "edge" in sys.argv[1:]:
        from ee_probe_v2 import edge_probe
        edge_probe()
    elif "v2b" in sys.argv[1:]:
        from ee_probe_v2 import probe_v2_round2
        probe_v2_round2()
    else:
        water_share_check()
    return 0


def water_share_check(month: int = 10, width: int = 1024, height: int = 512) -> None:
    """Coarse water must be a share of the cell, not the mean over water pixels only. Compare against 30 m truth."""
    rec = ee.ImageCollection("JRC/GSW1_4/MonthlyRecurrence").filter(ee.Filter.eq("month", month)).first().select("monthly_recurrence")
    candidates = {
        "old (unmask)": rec.unmask(0),
        "mask share": rec.mask().unmask(0).multiply(100),
        "rec x mask": rec.multiply(rec.mask()).unmask(0),
    }
    dx, dy = 360 / width, 180 / height
    places = {"Doyang": (94.2, 26.2), "Nagaland hills": (94.6, 25.6), "Lake Victoria": (33.0, -1.0),
              "Vembanad": (76.35, 9.6), "Rann of Kutch": (70.0, 23.9), "Thar": (71.0, 27.0)}
    for name, (lng, lat) in places.items():
        ix, iy = int((lng + 180) / dx), int((90 - lat) / dy)
        x0, y0 = -180 + ix * dx, 90 - iy * dy
        cell = ee.Geometry.Rectangle([x0, y0 - dy, x0 + dx, y0], "EPSG:4326", False)
        truth = rec.unmask(0).reduceRegion(ee.Reducer.mean(), cell, 30, maxPixels=1e9).get("monthly_recurrence").getInfo()
        wet = rec.unmask(0).gte(50).reduceRegion(ee.Reducer.mean(), cell, 30, maxPixels=1e9).get("monthly_recurrence").getInfo()
        grid = {"dimensions": {"width": 1, "height": 1}, "crsCode": "EPSG:4326",
                "affineTransform": {"scaleX": dx, "shearX": 0, "translateX": x0, "shearY": 0, "scaleY": -dy, "translateY": y0}}
        got = {k: float(ee.data.computePixels({"expression": img.rename("v").toFloat(), "fileFormat": "NUMPY_NDARRAY", "grid": grid})["v"][0, 0])
               for k, img in candidates.items()}
        print(f"water share {name}: truth mean rec {truth:.2f} | area >=50% {100 * wet:.2f}% | " + " | ".join(f"{k} {v:.2f}" for k, v in got.items()))


if __name__ == "__main__":
    sys.exit(main())
