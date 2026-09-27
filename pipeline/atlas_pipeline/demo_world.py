"""SYNTHETIC worldwide journeys for the demo migrants, outside India.

Keys match the India demo species so the web app sees one continuous range. Every number is invented.
"""

import json
import random
from dataclasses import dataclass
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.prepared import prep

from .config import MONTHS
from .global_ranges import GlobalRange

LAND_PATH = Path(__file__).resolve().parents[1] / "assets" / "world_land.geojson"

# (lat_lo, lat_hi, lng_lo, lng_hi)
Box = tuple[int, int, int, int]


@dataclass(frozen=True)
class Stay:
    box: Box
    months: tuple[int, ...]
    rate: float


JOURNEYS: dict[str, tuple[Stay, ...]] = {
    "demo-falamu": (  # Amur Falcon: NE Asia breeding, India stopover (India demo), southern Africa winter
        Stay((42, 54, 110, 135), (5, 6, 7, 8), 0.05),
        Stay((30, 44, 104, 122), (9,), 0.04),
        Stay((20, 28, 95, 104), (10,), 0.03),
        Stay((-32, -12, 18, 36), (12, 1, 2), 0.07),
        Stay((-20, -5, 25, 38), (3,), 0.05),
        Stay((-2, 12, 36, 48), (4,), 0.05),
    ),
    "demo-ansind": (  # Bar-headed Goose: Tibetan plateau and Mongolian lakes in summer
        Stay((34, 40, 80, 100), (4, 5, 6, 7, 8, 9), 0.05),
        Stay((44, 49, 95, 105), (5, 6, 7, 8), 0.04),
    ),
    "demo-orikun": (  # Indian Golden Oriole: breeds into Central Asia
        Stay((34, 43, 62, 76), (5, 6, 7, 8), 0.02),
    ),
    "demo-clajac": (  # Pied Cuckoo: Indian population winters in East Africa
        Stay((-10, 8, 30, 42), (11, 12, 1, 2, 3, 4), 0.015),
    ),
    "demo-pasros": (  # Rosy Starling: breeds from the Black Sea to Central Asia
        Stay((40, 50, 30, 80), (5, 6, 7), 0.04),
        Stay((30, 40, 50, 68), (4, 8), 0.03),
    ),
    "demo-grukir": (  # Demoiselle Crane: breeds on the Central Asian and Mongolian steppe
        Stay((42, 52, 55, 110), (5, 6, 7, 8), 0.03),
        Stay((32, 42, 64, 76), (4, 9), 0.03),
    ),
    "demo-motcin": (  # Grey Wagtail: breeds across Europe and Central Asia
        Stay((40, 58, -5, 90), (4, 5, 6, 7, 8, 9), 0.015),
        Stay((0, 15, 30, 45), (11, 12, 1, 2), 0.01),
    ),
    "demo-merphi": (  # Blue-tailed Bee-eater: Southeast Asia and southern China
        Stay((5, 22, 95, 110), tuple(range(1, 13)), 0.012),
        Stay((22, 32, 100, 120), (5, 6, 7, 8), 0.015),
    ),
    "demo-phoros": (  # Greater Flamingo: East African lakes and the Mediterranean
        Stay((-10, 3, 32, 40), tuple(range(1, 13)), 0.04),
        Stay((36, 44, -8, 30), (3, 4, 5, 6, 7, 8, 9, 10), 0.02),
    ),
}


def _land():
    return prep(shape(json.loads(LAND_PATH.read_text())["features"][0]["geometry"]))


def _effort(lat: float, lng: float, month: int, rng: random.Random) -> int:
    base = 160.0
    if 35 <= lat <= 60 and -10 <= lng <= 40:
        base *= 3.0  # Europe has many observers
    elif -35 <= lat <= 15 and 10 <= lng <= 50:
        base *= 0.6
    elif 30 <= lat <= 55 and 60 <= lng <= 135:
        base *= 0.5
    return max(0, int(rng.gauss(base, base * 0.25) * (1.2 if month in (4, 5, 9, 10) else 1.0)))


def demo_world_ranges(exclude: set[str], seed: int = 11) -> tuple[GlobalRange, ...]:
    """Build synthetic ranges for cells outside `exclude` (the India detail cells)."""
    land = _land()
    rng = random.Random(seed)
    out = []
    for key, stays in JOURNEYS.items():
        cells: dict[str, tuple[tuple[int, ...], tuple[int, ...]]] = {}
        for stay in stays:
            lat_lo, lat_hi, lng_lo, lng_hi = stay.box
            for lat in range(lat_lo, lat_hi):
                for lng in range(lng_lo, lng_hi):
                    cid = f"{lat}_{lng}"
                    if cid in exclude or not land.contains(Point(lng + 0.5, lat + 0.5)):
                        continue
                    prev_counts, totals = cells.get(cid, ((0,) * MONTHS, tuple(_effort(lat, lng, m, rng) for m in range(1, MONTHS + 1))))
                    counts = tuple(
                        c + (int(totals[m - 1] * stay.rate * rng.uniform(0.6, 1.4)) if m in stay.months else 0)
                        for m, c in zip(range(1, MONTHS + 1), prev_counts)
                    )
                    cells[cid] = (counts, totals)
        out.append(GlobalRange(key, {}, {cid: v for cid, v in cells.items() if sum(v[0]) > 0}))
    return tuple(out)
