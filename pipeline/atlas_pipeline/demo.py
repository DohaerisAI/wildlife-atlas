"""SYNTHETIC demo data for building the UI before real GBIF data is fetched.

Species names are real; every number is invented from hand-written seasonal shapes.
The bundle is flagged demo=true and the web client shows a banner. Never publish it as evidence.
"""

import json
import math
import random
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from shapely.geometry import box, shape

from .aggregate import CellSummary
from .config import INDIA, MONTHS
from .grid import Cell, region_cells

MASK_PATH = Path(__file__).resolve().parents[1] / "assets" / "india_mask.geojson"
MIN_LAND_FRACTION = 0.15

# rate(lat, lng, month 1..12) -> expected share of bird records
RateFn = Callable[[float, float, int], float]


@dataclass(frozen=True)
class DemoSpecies:
    key: str
    common: str
    scientific: str
    family: str
    rate: RateFn


def _months(*active: int) -> Callable[[int], float]:
    return lambda m: 1.0 if m in active else 0.0


def _box(lat_lo: float, lat_hi: float, lng_lo: float, lng_hi: float) -> Callable[[float, float], float]:
    return lambda lat, lng: 1.0 if lat_lo <= lat <= lat_hi and lng_lo <= lng <= lng_hi else 0.0


def _not_himalaya(lat: float, lng: float) -> float:
    return 0.0 if lat > 32 else 1.0


WINTER = _months(10, 11, 12, 1, 2, 3)
SUMMER = _months(4, 5, 6, 7, 8, 9)
MONSOON = _months(6, 7, 8, 9)

SPECIES = [
    DemoSpecies("demo-pavcri", "Indian Peafowl", "Pavo cristatus", "Phasianidae",
                lambda la, ln, m: 0.03 * _not_himalaya(la, ln) * (0.4 if ln > 89 else 1.0)),
    DemoSpecies("demo-corspl", "House Crow", "Corvus splendens", "Corvidae",
                lambda la, ln, m: 0.05 * _not_himalaya(la, ln)),
    DemoSpecies("demo-acrtri", "Common Myna", "Acridotheres tristis", "Sturnidae",
                lambda la, ln, m: 0.06 * _not_himalaya(la, ln)),
    DemoSpecies("demo-milmig", "Black Kite", "Milvus migrans", "Accipitridae",
                lambda la, ln, m: 0.025 * (1.3 if WINTER(m) else 1.0)),
    DemoSpecies("demo-eudsco", "Asian Koel", "Eudynamys scolopaceus", "Cuculidae",
                lambda la, ln, m: 0.03 * _not_himalaya(la, ln) * (1.5 if m in (3, 4, 5, 6) else 0.8)),
    DemoSpecies("demo-ansind", "Bar-headed Goose", "Anser indicus", "Anatidae",
                lambda la, ln, m: 0.02 * WINTER(m) * _box(19, 31, 70, 90)(la, ln)
                + 0.03 * _months(5, 6, 7, 8)(m) * _box(32, 36, 75, 80)(la, ln)),
    DemoSpecies("demo-falamu", "Amur Falcon", "Falco amurensis", "Falconidae",
                lambda la, ln, m: 0.08 * _months(10, 11)(m) * _box(23, 28, 91, 96)(la, ln)
                + 0.01 * _months(11)(m) * _box(12, 23, 74, 88)(la, ln)),
    DemoSpecies("demo-orikun", "Indian Golden Oriole", "Oriolus kundoo", "Oriolidae",
                lambda la, ln, m: 0.015 * SUMMER(m) * (1.0 if la >= 21 else 0.2) * _not_himalaya(la, ln)
                + 0.015 * WINTER(m) * (1.0 if la < 20 else 0.0)),
    DemoSpecies("demo-merphi", "Blue-tailed Bee-eater", "Merops philippinus", "Meropidae",
                lambda la, ln, m: 0.012 * SUMMER(m) * (1.0 if la >= 22 else 0.0) * _not_himalaya(la, ln)
                + 0.012 * WINTER(m) * (1.0 if la < 18 else 0.0)),
    DemoSpecies("demo-pasros", "Rosy Starling", "Pastor roseus", "Sturnidae",
                lambda la, ln, m: 0.03 * _months(9, 10, 11, 12, 1, 2, 3)(m) * (1.0 if la < 26 and ln < 84 else 0.0)),
    DemoSpecies("demo-grukir", "Demoiselle Crane", "Grus virgo", "Gruidae",
                lambda la, ln, m: 0.04 * _months(9, 10, 11, 12, 1, 2, 3)(m) * _box(20, 29, 68, 76)(la, ln)),
    DemoSpecies("demo-phoros", "Greater Flamingo", "Phoenicopterus roseus", "Phoenicopteridae",
                lambda la, ln, m: 0.03 * _box(20, 25, 68, 73)(la, ln)
                + 0.02 * WINTER(m) * _box(12, 20, 78, 87)(la, ln)),
    DemoSpecies("demo-clajac", "Pied Cuckoo", "Clamator jacobinus", "Cuculidae",
                lambda la, ln, m: 0.01 * MONSOON(m) * (1.0 if la >= 20 else 0.3) * _not_himalaya(la, ln)),
    DemoSpecies("demo-motcin", "Grey Wagtail", "Motacilla cinerea", "Motacillidae",
                lambda la, ln, m: 0.02 * WINTER(m) * (1.0 if la < 28 else 0.0)
                + 0.02 * SUMMER(m) * (1.0 if la >= 29 else 0.0)),
    DemoSpecies("demo-alcatt", "Common Kingfisher", "Alcedo atthis", "Alcedinidae",
                lambda la, ln, m: 0.012),
]


def land_cells(mask_path: Path = MASK_PATH) -> list[Cell]:
    geom = shape(json.loads(mask_path.read_text())["features"][0]["geometry"])
    keep = []
    for cell in region_cells(INDIA):
        tile = box(cell.lng0, cell.lat0, cell.lng0 + cell.size, cell.lat0 + cell.size)
        if tile.intersection(geom).area / tile.area >= MIN_LAND_FRACTION:
            keep.append(cell)
    return keep


def _effort(lat: float, lng: float, month: int, rng: random.Random) -> int:
    hotspot = 3.0 if (8 <= lat <= 14 and 74 <= lng <= 78) else 1.0  # Kerala/Karnataka birders
    hotspot *= 2.0 if (26 <= lat <= 30 and 76 <= lng <= 79) else 1.0  # Delhi NCR
    hotspot *= 0.3 if (lat > 32 or lng > 92) else 1.0
    winter = 1.0 + 0.6 * math.cos((month - 1) / 12 * 2 * math.pi)
    return max(0, int(rng.gauss(400, 120) * hotspot * winter))


def demo_cells(seed: int = 7) -> list[CellSummary]:
    rng = random.Random(seed)
    summaries = []
    for cell in land_cells():
        lat, lng = cell.center
        totals = tuple(_effort(lat, lng, m, rng) for m in range(1, MONTHS + 1))
        species = {}
        for sp in SPECIES:
            counts = tuple(
                int(totals[m - 1] * sp.rate(lat, lng, m) * rng.uniform(0.6, 1.4)) for m in range(1, MONTHS + 1)
            )
            if sum(counts) > 0:
                species[sp.key] = counts
        summaries.append(CellSummary(cell.id, totals, species))
    return summaries


def demo_names() -> dict[str, dict]:
    return {
        sp.key: {"key": sp.key, "scientific": sp.scientific, "common": sp.common, "family": sp.family}
        for sp in SPECIES
    }
