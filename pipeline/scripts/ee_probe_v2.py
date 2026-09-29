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


LAKES = {"Superior": (-87.5, 47.7), "Caspian": (51.0, 42.0), "Baikal": (108.0, 53.5), "Black Sea": (34.0, 43.0),
         "Mumbai coast sea": (72.6, 18.9), "Victoria": (33.0, -1.0), "Hudson Bay": (-85.0, 60.0)}


def _class_methods():
    wc = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map")
    proj = ee.Projection("EPSG:4326")

    def from_level(deg):  # majority of a pyramid level `deg` wide, reduced to the output grid
        return wc.reproject(proj.scale(deg, deg)).reduceResolution(ee.Reducer.mode(), False, 65535)
    return wc, {"pyramid": wc, "rr 1km": from_level(1 / 112), "rr 300m": from_level(1 / 360)}


def class_agreement(region=(68, 8, 90, 32), n=120, width=4096, height=2048):
    """Share of cells where each method's class equals the 100 m majority (the reference)."""
    import numpy as np
    wc, methods = _class_methods()
    dx, dy = 360 / width, 180 / height
    rng = np.random.default_rng(7)
    ix = rng.integers(int((region[0] + 180) / dx), int((region[2] + 180) / dx), n)
    iy = rng.integers(int((90 - region[3]) / dy), int((90 - region[1]) / dy), n)
    feats = [ee.Feature(ee.Geometry.Rectangle([-180 + i * dx, 90 - (j + 1) * dy, -180 + (i + 1) * dx, 90 - j * dy], "EPSG:4326", False), {"k": k})
             for k, (i, j) in enumerate(zip(ix, iy))]
    ref = ee.FeatureCollection(feats).map(lambda f: f.set("h", wc.reduceRegion(ee.Reducer.frequencyHistogram(), f.geometry(), 100, maxPixels=1e8).get("Map")))
    hist = ref.aggregate_array("h").getInfo()
    truth = [max(h.items(), key=lambda kv: kv[1])[0] if h else "0" for h in hist]
    for name, img in methods.items():
        t = time.time()
        pts = ee.FeatureCollection([ee.Feature(ee.Geometry.Point([-180 + (i + 0.5) * dx, 90 - (j + 0.5) * dy])) for i, j in zip(ix, iy)])
        got = img.unmask(0).rename("c").reduceRegions(pts, ee.Reducer.first(), crs="EPSG:4326", crsTransform=[dx, 0, -180, 0, -dy, 90]).aggregate_array("first").getInfo()
        ok = sum(str(int(g)) == t_ for g, t_ in zip(got, truth) if t_ != "0")
        land = sum(1 for t_ in truth if t_ != "0")
        print(f"  {name}: {ok}/{land} land cells match the 100 m majority ({time.time() - t:.1f}s); first 12 got {[int(g) for g in got[:12]]} truth {truth[:12]}")


def class_cost():
    import numpy as np
    _, methods = _class_methods()
    for name, img in methods.items():
        t = time.time()
        try:
            arr = ee.data.computePixels({"expression": img.unmask(0).rename("c").toFloat(), "fileFormat": "NUMPY_NDARRAY",
                                         "grid": grid(4096, 128, -180, 40, 360 / 4096, 180 / 2048)})
            print(f"  {name}: 4096x128 strip at 40N {time.time() - t:.1f}s, classes {np.unique(arr['c']).tolist()}")
        except Exception as e:
            print(f"  {name}: ERROR {repr(e)[:300]} ({time.time() - t:.1f}s)")


def hycom_budget():
    import numpy as np
    col = ee.ImageCollection("HYCOM/sea_water_velocity").select(["velocity_u_0", "velocity_v_0"])
    july = col.filter(ee.Filter.calendarRange(7, 7, "month")).filter(ee.Filter.calendarRange(0, 0, "hour"))
    tries = {"July 2020 daily": july.filterDate("2020-01-01", "2021-01-01"),
             "July 2015-2024 every 3rd day": july.filterDate("2015-01-01", "2025-01-01").filter(ee.Filter.inList("day_of_month", [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31])),
             "July 2015-2024 daily": july.filterDate("2015-01-01", "2025-01-01")}
    for name, c in tries.items():
        c = c.map(lambda im: im.set("day_of_month", ee.Date(im.get("system:time_start")).get("day"))) if "3rd" not in name else c
        for rows in (180, 45):
            t = time.time()
            try:
                mean = c.mean().multiply(0.001).unmask(-99).toFloat()
                arr = ee.data.computePixels({"expression": mean, "fileFormat": "NUMPY_NDARRAY", "grid": grid(720, rows, -180, 30, 0.5, 0.5)})
                u = arr["velocity_u_0"]
                print(f"  {name} 720x{rows}: {time.time() - t:.1f}s ocean {(u > -90).sum()} |u| p99 {np.percentile(np.abs(u[u > -90]), 99):.2f}")
            except Exception as e:
                print(f"  {name} 720x{rows}: ERROR {repr(e)[:200]} ({time.time() - t:.1f}s)")
    one = july.filterDate("2020-01-01", "2021-01-01").mean().multiply(0.001)
    for name in ("Somali current", "Gulf Stream", "Arabian Sea"):
        print(" ", name, "July 2020", cell_value(one.unmask(-99), *PLACES[name], 720, 360)[0])
    mask = col.filterDate("2020-07-01", "2020-07-02").first().select("velocity_u_0").mask().rename("m")
    for name, (lng, lat) in LAKES.items():
        print(f"  HYCOM ocean share {name}: {cell_value(mask.unmask(0), lng, lat, 4096, 2048)[0]}")


def probe_v2_round2():
    for title, fn in (("Class agreement India", class_agreement),
                      ("Class agreement Amazon", lambda: class_agreement((-75, -15, -45, 5))),
                      ("Class agreement Europe", lambda: class_agreement((-5, 40, 30, 60))),
                      ("Class pull cost", class_cost), ("HYCOM budget", hycom_budget)):
        section(title, fn)


def edge_probe():
    """Which inputs fail on a tile touching 180E ("Unable to transform edge"), and which workaround fixes it."""
    elev = ee.Image("NOAA/NGDC/ETOPO1").select("ice_surface").toFloat()
    lights = ee.ImageCollection("NOAA/VIIRS/DNB/ANNUAL_V22").filterDate("2022-01-01", "2025-01-01").select("average_masked").mean()
    hycom = ee.ImageCollection("HYCOM/sea_water_velocity").filterDate("2020-07-01", "2020-07-02").first().select("velocity_u_0")
    wc = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map")
    tree = ee.ImageCollection("MODIS/061/MOD44B").filterDate("2020-01-01", "2025-01-01").select("Percent_Tree_Cover").mean()
    cands = {"etopo": elev, "etopo hillshade": ee.Terrain.hillshade(elev.multiply(10)), "viirs": lights.unmask(0),
             "viirs raw mean": lights, "hycom mask": hycom.mask().unmask(0), "worldcover": wc.unmask(0), "wc mask": wc.mask().unmask(0),
             "tree": tree.unmask(0), "hycom mean": hycom.multiply(0.001).unmask(-1)}
    for w, h, top in ((2048, 1024, 256), (4096, 2048, 128), (720, 360, 180)):
        dx = 360 / w
        for name, img in cands.items():
            for label, x0, tw in (("right edge", 180 - 256 * dx, 256), ("left edge", -180, 256), ("full row", -180, w)):
                g = grid(tw, 16, x0, 90 - top * dx, dx, dx)
                try:
                    ee.data.computePixels({"expression": img.rename("v").toFloat(), "fileFormat": "NUMPY_NDARRAY", "grid": g})
                    res = "ok"
                except Exception as e:
                    res = "ERROR " + str(e)[:90]
                print(f"  {w}x{h} {name} {label}: {res}")
