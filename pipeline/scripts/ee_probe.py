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
    return 0


if __name__ == "__main__":
    sys.exit(main())
