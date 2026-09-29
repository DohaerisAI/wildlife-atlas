"""Region shards for the worldwide bird product, and the GBIF SQL query that fetches one shard.

The shards tile the globe exactly (no gaps, no overlaps) on whole degrees, so every 1° cell belongs to
one shard and re-running a shard replaces only that shard's cells. Order is the publishing order.
Boxes are (lat0, lat1, lng0, lng1), half-open except at the north pole and the antimeridian.
"""

from dataclasses import dataclass

from .config import SENSITIVE_SPECIES, FetchSettings


@dataclass(frozen=True)
class Shard:
    id: str
    name: str
    boxes: tuple[tuple[int, int, int, int], ...]

    def contains(self, lat0: int, lng0: int) -> bool:
        return any(a <= lat0 < b and c <= lng0 < d for a, b, c, d in self.boxes)


SHARDS = (
    Shard("south-asia", "South Asia", ((0, 40, 60, 100),)),
    Shard("africa", "Africa and Arabia", ((-90, 38, -30, 60),)),
    Shard("europe", "Europe and the Middle East", ((38, 90, -30, 60),)),
    Shard("east-asia", "East, Southeast and North Asia", ((0, 90, 100, 180), (40, 90, 60, 100))),
    Shard("americas", "The Americas", ((-90, 90, -180, -30),)),
    Shard("oceania", "Oceania and the southern oceans", ((-90, 0, 60, 180),)),
)
SHARD_IDS = tuple(s.id for s in SHARDS)


def shard_by_id(shard_id: str) -> Shard:
    for s in SHARDS:
        if s.id == shard_id:
            return s
    raise ValueError(f"Unknown shard {shard_id!r}; expected one of {', '.join(SHARD_IDS)}")


def _box_sql(lat0: int, lat1: int, lng0: int, lng1: int) -> str:
    lat_hi = "<=" if lat1 == 90 else "<"
    lng_hi = "<=" if lng1 == 180 else "<"
    return (f"(decimallatitude >= {lat0} AND decimallatitude {lat_hi} {lat1} "
            f"AND decimallongitude >= {lng0} AND decimallongitude {lng_hi} {lng1})")


def _quote(name: str) -> str:
    return "'" + name.replace("'", "''") + "'"


def shard_sql(shard: Shard, settings: FetchSettings = FetchSettings(), sensitive: frozenset[str] = SENSITIVE_SPECIES) -> str:
    """Birds recorded in the shard, counted by species, 1° cell and month.

    Rows with no species (records identified only to genus or family) are kept: they count toward the
    cell's bird-record total (the effort baseline) but never appear as a species. Sensitive species are
    filtered out on GBIF's side so they are never fetched at fine resolution (decision 0007).
    """
    y0, y1 = (int(v) for v in settings.year_range.split(","))
    boxes = " OR ".join(_box_sql(*b) for b in shard.boxes)
    hidden = ", ".join(_quote(n) for n in sorted(sensitive))
    return (
        'SELECT specieskey, species, family, "month", '
        "FLOOR(decimallatitude) AS lat0, FLOOR(decimallongitude) AS lng0, COUNT(*) AS n "
        "FROM occurrence "
        "WHERE \"class\" = 'Aves' AND occurrencestatus = 'PRESENT' "
        "AND hascoordinate = TRUE AND hasgeospatialissues = FALSE "
        f'AND "year" >= {y0} AND "year" <= {y1} AND "month" IS NOT NULL '
        f"AND ({boxes}) "
        f"AND (species IS NULL OR species NOT IN ({hidden})) "
        'GROUP BY specieskey, species, family, "month", FLOOR(decimallatitude), FLOOR(decimallongitude)'
    )
