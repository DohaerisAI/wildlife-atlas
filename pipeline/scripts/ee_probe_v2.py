"""Probe the pack v2 datasets: band names, scales, date ranges, pyramid behaviour and pull cost."""

import time

import ee

PLACES = {"Western Ghats": (75.7, 12.3), "Thar": (71.0, 27.0), "Everest": (86.92, 27.99), "Tokyo": (139.75, 35.68),
          "Mumbai coast sea": (72.6, 18.9), "Arabian Sea": (65.0, 15.0), "Somali current": (52.0, 8.0),
          "Gulf Stream": (-70.0, 38.0), "Sundarbans": (89.2, 21.9), "Greenland": (-40.0, 72.0), "Amazon": (-60.0, -3.0)}


def grid(width, height, x0=-180.0, y0=90.0, dx=None, dy=None):
    dx = dx if dx is not None else 360 / width
    dy = dy if dy is not None else 180 / height
    return {"dimensions": {"width": width, "height": height}, "crsCode": "EPSG:4326",
            "affineTransform": {"scaleX": dx, "shearX": 0, "translateX": x0, "shearY": 0, "scaleY": -dy, "translateY": y0}}


def cell_value(img, lng, lat, width, height):
    """What a full-globe width x height pull returns for the cell holding (lng, lat)."""
    dx, dy = 360 / width, 180 / height
    ix, iy = int((lng + 180) / dx), int((90 - lat) / dy)
    x0, y0 = -180 + ix * dx, 90 - iy * dy
    arr = ee.data.computePixels({"expression": img.toFloat(), "fileFormat": "NUMPY_NDARRAY", "grid": grid(1, 1, x0, y0, dx, dy)})
    return {b: round(float(arr[b][0, 0]), 4) for b in arr.dtype.names}, ee.Geometry.Rectangle([x0, y0 - dy, x0 + dx, y0], "EPSG:4326", False)


def section(title, fn):
    print(f"\n== {title}")
    t = time.time()
    try:
        fn()
    except Exception as e:  # keep probing the rest; the error is the finding
        print("  ERROR:", repr(e)[:600])
    print(f"  ({time.time() - t:.1f}s)")


def describe(col_id):
    col = ee.ImageCollection(col_id)
    info = ee.Dictionary({"n": col.size(), "t0": col.aggregate_min("system:time_start"), "t1": col.aggregate_max("system:time_start")}).getInfo()
    first = col.first()
    print(f"  {col_id}: n={info['n']} {ee.Date(info['t0']).format('YYYY-MM-dd HH:mm').getInfo()} .. "
          f"{ee.Date(info['t1']).format('YYYY-MM-dd HH:mm').getInfo()} bands={first.bandNames().getInfo()}")
    print("  first props:", {k: v for k, v in first.toDictionary().getInfo().items()})
    print("  first band types:", first.bandTypes().getInfo())


def worldcover():
    describe("ESA/WorldCover/v200")
    try:
        asset = ee.data.getAsset(ee.ImageCollection("ESA/WorldCover/v200").first().get("system:id").getInfo())
        print("  pyramiding:", [(b.get("id"), b.get("pyramidingPolicy")) for b in asset.get("bands", [])])
    except Exception as e:
        print("  getAsset failed:", repr(e)[:300])
    wc = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map")
    img = ee.Image.cat(wc.unmask(0).rename("cls"), wc.mask().unmask(0).rename("mask"))
    for name, (lng, lat) in PLACES.items():
        got, cell = cell_value(img, lng, lat, 4096, 2048)
        hist = wc.reduceRegion(ee.Reducer.frequencyHistogram(), cell, 200, maxPixels=1e8).get("Map").getInfo()
        top = sorted((hist or {}).items(), key=lambda kv: -kv[1])[:3]
        print(f"  {name}: pyramid {got} | 200 m histogram top {[(k, round(v)) for k, v in top]}")


def tree_cover():
    describe("MODIS/061/MOD44B")
    col = ee.ImageCollection("MODIS/061/MOD44B").select("Percent_Tree_Cover")
    img = col.filterDate("2019-01-01", "2025-01-01").mean().rename("tree")
    raw = col.sort("system:time_start", False).first().rename("raw")
    for name in ("Western Ghats", "Thar", "Amazon", "Arabian Sea", "Tokyo"):
        print(" ", name, cell_value(ee.Image.cat(img.unmask(-1), raw.unmask(-1), img.mask().unmask(0).rename("m")), *PLACES[name], 4096, 2048)[0])


def etopo():
    e = ee.Image("NOAA/NGDC/ETOPO1")
    print("  bands:", e.bandNames().getInfo(), e.bandTypes().getInfo(), "scale m:", e.projection().nominalScale().getInfo())
    for name in ("Everest", "Thar", "Arabian Sea", "Greenland"):
        print(" ", name, cell_value(e, *PLACES[name], 2048, 1024)[0])
    elev = e.select("ice_surface").toFloat()
    for z in (1, 5, 20):
        hs = ee.Terrain.hillshade(elev.multiply(z)).rename("hs")
        arr = ee.data.computePixels({"expression": hs.toFloat(), "fileFormat": "NUMPY_NDARRAY", "grid": grid(256, 128, 60, 40, 360 / 4096, 180 / 2048)})
        import numpy as np
        v = arr["hs"].astype("float64")
        print(f"  hillshade x{z} (60-82E, 29-40N at 4096 grid): p1 {np.percentile(v, 1):.0f} p50 {np.percentile(v, 50):.0f} p99 {np.percentile(v, 99):.0f}")


def viirs():
    for cid in ("NOAA/VIIRS/DNB/ANNUAL_V22", "NOAA/VIIRS/DNB/ANNUAL_V21"):
        try:
            describe(cid)
        except Exception as e:
            print("  ", cid, "ERROR", repr(e)[:300])
    col = ee.ImageCollection("NOAA/VIIRS/DNB/ANNUAL_V22")
    last = col.sort("system:time_start", False).first()
    am = last.select("average_masked")
    img = ee.Image.cat(last.select("average").rename("avg"), am.unmask(0).rename("am_unmask"),
                       am.multiply(am.mask()).unmask(0).rename("am_share"), am.mask().unmask(0).rename("mask"))
    for name in ("Tokyo", "Thar", "Western Ghats", "Arabian Sea", "Mumbai coast sea"):
        print(" ", name, cell_value(img, *PLACES[name], 2048, 1024)[0])


def hycom():
    col = ee.ImageCollection("HYCOM/sea_water_velocity")
    sub = col.filterDate("2020-01-01", "2020-02-01")
    print("  Jan 2020 images:", sub.size().getInfo(), "bands:", sub.first().bandNames().getInfo()[:6], sub.first().bandTypes().getInfo().get("velocity_u_0"))
    print("  first props:", sub.first().toDictionary().getInfo())
    info = ee.Dictionary({"t0": col.aggregate_min("system:time_start"), "t1": col.aggregate_max("system:time_start")}).getInfo()
    print("  range:", ee.Date(info["t0"]).format("YYYY-MM-dd").getInfo(), ee.Date(info["t1"]).format("YYYY-MM-dd").getInfo())
    daily = col.filterDate("2015-01-01", "2025-01-01").filter(ee.Filter.calendarRange(7, 7, "month")).filter(ee.Filter.calendarRange(0, 0, "hour"))
    print("  July 2015-2024 00h images:", daily.size().getInfo())
    mean = daily.select(["velocity_u_0", "velocity_v_0"]).mean().multiply(0.001)
    for name in ("Somali current", "Gulf Stream", "Arabian Sea", "Thar"):
        print(" ", name, cell_value(mean.unmask(-99), *PLACES[name], 720, 360)[0])
    t = time.time()
    arr = ee.data.computePixels({"expression": mean.unmask(-99).toFloat(), "fileFormat": "NUMPY_NDARRAY", "grid": grid(720, 180, dy=0.5)})
    import numpy as np
    u = arr["velocity_u_0"]
    print(f"  720x180 July mean pull {time.time() - t:.1f}s, ocean cells {(u > -90).sum()}, |u| p99 {np.percentile(np.abs(u[u > -90]), 99):.2f}")


def chlorophyll():
    describe("NASA/OCEANDATA/MODIS-Aqua/L3SMI")
    col = ee.ImageCollection("NASA/OCEANDATA/MODIS-Aqua/L3SMI").filterDate("2015-01-01", "2025-01-01").filter(ee.Filter.calendarRange(7, 7, "month")).select("chlor_a")
    print("  July 2015-2024 images:", col.size().getInfo())
    mean = col.mean()
    for name in ("Arabian Sea", "Somali current", "Mumbai coast sea", "Gulf Stream", "Thar"):
        print(" ", name, cell_value(mean.unmask(-1), *PLACES[name], 720, 360)[0])
    t = time.time()
    arr = ee.data.computePixels({"expression": mean.unmask(-1).toFloat(), "fileFormat": "NUMPY_NDARRAY", "grid": grid(720, 180, dy=0.5)})
    import numpy as np
    c = arr["chlor_a"]
    print(f"  720x180 July mean pull {time.time() - t:.1f}s, valid {(c >= 0).sum()}, p1 {np.percentile(c[c >= 0], 1):.3f} p99 {np.percentile(c[c >= 0], 99):.2f}")


def probe_v2():
    for title, fn in (("WorldCover", worldcover), ("Tree cover", tree_cover), ("ETOPO1", etopo), ("VIIRS", viirs),
                      ("HYCOM", hycom), ("Chlorophyll", chlorophyll)):
        section(title, fn)
