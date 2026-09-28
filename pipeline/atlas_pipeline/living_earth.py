"""Living Earth globe pack: 12 monthly global layers computed in Earth Engine, packed as PNG atlases.

surface.png  4 x 3 months, each 1024 x 512, RGB = water recurrence, snow cover, greenness (NDVI)
climate.png  4 x 3 months, each 360 x 180, RGB = wind east (u), wind north (v), air temperature
manifest.json  sources, value ranges for decoding, grid and build date (L2 contract, decision 0004)
"""

import json
import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

log = logging.getLogger(__name__)
MONTHS = 12
COLS, ROWS = 4, 3


@dataclass(frozen=True)
class Channel:
    name: str
    lo: float
    hi: float
    unit: str
    source: str


SURFACE = (
    Channel("water", 0, 100, "expected % of the cell under water that month", "JRC/GSW1_4/MonthlyRecurrence x water share of the cell"),
    Channel("snow", 0, 100, "% snow cover", "MODIS/061/MOD10A1 NDSI_Snow_Cover, 2015-2024 mean"),
    Channel("ndvi", -0.2, 0.9, "NDVI", "MODIS/061/MOD13A2 NDVI, 2015-2024 mean"),
)
CLIMATE = (
    Channel("wind_u", -15, 15, "m/s (towards east)", "ECMWF/ERA5/MONTHLY u_component_of_wind_10m, 1991-2020 mean"),
    Channel("wind_v", -15, 15, "m/s (towards north)", "ECMWF/ERA5/MONTHLY v_component_of_wind_10m, 1991-2020 mean"),
    Channel("temp", -40, 45, "°C at 2 m", "ECMWF/ERA5/MONTHLY mean_2m_air_temperature, 1991-2020 mean"),
)


def to_byte(values: np.ndarray, ch: Channel) -> np.ndarray:
    """Scale to 0..255 by the channel's range; NaN (no data) becomes 0."""
    v = np.nan_to_num(values.astype("float64"), nan=ch.lo)
    return np.clip(np.round((v - ch.lo) / (ch.hi - ch.lo) * 255), 0, 255).astype("uint8")


def from_byte(b: np.ndarray, ch: Channel) -> np.ndarray:
    return ch.lo + b.astype("float64") / 255 * (ch.hi - ch.lo)


def pack_atlas(months: list[np.ndarray]) -> np.ndarray:
    """12 arrays of (h, w, 3) uint8 -> one (3h, 4w, 3) atlas, row-major Jan..Dec."""
    if len(months) != MONTHS:
        raise ValueError(f"need {MONTHS} months, got {len(months)}")
    h, w, c = months[0].shape
    atlas = np.zeros((ROWS * h, COLS * w, c), dtype="uint8")
    for i, m in enumerate(months):
        if m.shape != (h, w, c):
            raise ValueError(f"month {i + 1} has shape {m.shape}, expected {(h, w, c)}")
        r, k = divmod(i, COLS)
        atlas[r * h:(r + 1) * h, k * w:(k + 1) * w] = m
    return atlas


def write_pack(out_dir: Path, surface: list[np.ndarray], climate: list[np.ndarray]) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pack_atlas(surface), "RGB").save(out_dir / "surface.png", optimize=True)
    Image.fromarray(pack_atlas(climate), "RGB").save(out_dir / "climate.png", optimize=True)
    manifest = {
        "version": 1,
        "built": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "layout": {"cols": COLS, "rows": ROWS, "order": "Jan..Dec row-major", "projection": "equirectangular, north up, 180W at left"},
        "surface": {"file": "surface.png", "month": list(surface[0].shape[1::-1]), "channels": [asdict(c) for c in SURFACE]},
        "climate": {"file": "climate.png", "month": list(climate[0].shape[1::-1]), "channels": [asdict(c) for c in CLIMATE]},
        "attribution": "EC JRC/Google (Global Surface Water); NASA LP DAAC / NSIDC (MODIS); Copernicus Climate Change Service (ERA5).",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1))
    return manifest


def water_share(rec):
    """Expected % of each output cell under water in the month.

    Coarse pyramid levels of JRC recurrence average only the pixels that ever held water, so a cell with
    one pond reads ~80 %. Its mask, though, is pyramided as the share of such pixels. Recurrence x mask
    is the cell-wide mean; ee_probe.py checks it against a 30 m reduction (Doyang 1.3 vs 0.56 true, old 81).
    """
    return rec.multiply(rec.mask()).unmask(0)


def _grid(width: int, height: int) -> dict:
    return {"dimensions": {"width": width, "height": height}, "crsCode": "EPSG:4326",
            "affineTransform": {"scaleX": 360 / width, "shearX": 0, "translateX": -180, "shearY": 0, "scaleY": -180 / height, "translateY": 90}}


def compute_months(ee, width: int = 1024, height: int = 512, climate_size: tuple[int, int] = (360, 180)) -> tuple[list, list]:
    """Pull every month from Earth Engine with computePixels (no export bucket needed)."""
    def pull(image, grid, bands):
        arr = ee.data.computePixels({"expression": image, "fileFormat": "NUMPY_NDARRAY", "grid": grid})
        return np.stack([arr[b].astype("float64") for b in bands], axis=-1)

    rec = ee.ImageCollection("JRC/GSW1_4/MonthlyRecurrence")
    snow = ee.ImageCollection("MODIS/061/MOD10A1").filterDate("2015-01-01", "2025-01-01").select("NDSI_Snow_Cover")
    ndvi = ee.ImageCollection("MODIS/061/MOD13A2").filterDate("2015-01-01", "2025-01-01").select("NDVI")
    era = ee.ImageCollection("ECMWF/ERA5/MONTHLY").filterDate("1991-01-01", "2021-01-01")
    g, gc = _grid(width, height), _grid(*climate_size)
    surface, climate = [], []
    for m in range(1, MONTHS + 1):
        cal = ee.Filter.calendarRange(m, m, "month")
        img = ee.Image.cat(
            water_share(rec.filter(ee.Filter.eq("month", m)).first().select("monthly_recurrence")).rename("water"),
            snow.filter(cal).mean().unmask(0).rename("snow"),
            ndvi.filter(cal).mean().multiply(0.0001).unmask(-0.2).rename("ndvi"),
        ).toFloat()
        s = pull(img, g, ["water", "snow", "ndvi"])
        surface.append(np.stack([to_byte(s[..., i], c) for i, c in enumerate(SURFACE)], axis=-1))
        e = era.filter(cal).mean()
        cimg = ee.Image.cat(e.select("u_component_of_wind_10m").rename("wind_u"), e.select("v_component_of_wind_10m").rename("wind_v"),
                            e.select("mean_2m_air_temperature").subtract(273.15).rename("temp")).toFloat()
        c = pull(cimg, gc, ["wind_u", "wind_v", "temp"])
        climate.append(np.stack([to_byte(c[..., i], ch) for i, ch in enumerate(CLIMATE)], axis=-1))
        log.info("month %d done", m)
    return surface, climate
