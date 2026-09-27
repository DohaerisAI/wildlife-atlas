"""Pipeline settings. Thresholds here are product labels, not biology; tune with ecological review."""

from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "data" / "raw"
OUT_DIR = REPO_ROOT / "web" / "public" / "data"

MONTHS = 12
AVES_CLASS_KEY = 212  # GBIF backbone key for class Aves


@dataclass(frozen=True)
class Region:
    country: str
    lat_min: int
    lat_max: int
    lng_min: int
    lng_max: int
    cell_deg: float


INDIA = Region(country="IN", lat_min=6, lat_max=37, lng_min=68, lng_max=98, cell_deg=1.0)


@dataclass(frozen=True)
class ClassifyRules:
    min_month_effort: int = 30  # bird records in a cell-month before it counts as surveyed
    min_adequate_months: int = 6
    min_species_records: int = 5
    rel_presence: float = 0.2  # month counts as present if rate >= this * peak rate
    resident_max_absent: int = 1
    passage_max_months: int = 4
    passage_max_run: int = 2


@dataclass(frozen=True)
class CoverageRules:
    well: int = 500
    some: int = 50


@dataclass(frozen=True)
class FetchSettings:
    year_range: str = "2010,2026"
    facet_limit: int = 2000
    request_delay_s: float = 0.6  # one request at a time with a pause: GBIF rate-limits bursts (HTTP 429)
    timeout_s: float = 60.0
    retries: int = 7  # with throttle backoff this waits up to ~45 min for a rate limit to lift


# Species followed worldwide (ranges beyond India). Any animal group works: the effort baseline
# for each species is its own taxonomic class (birds vs birds, mammals vs mammals).
FEATURED_SPECIES = (
    "Falco amurensis",
    "Anser indicus",
    "Oriolus kundoo",
    "Clamator jacobinus",
    "Pastor roseus",
    "Grus virgo",
    "Merops philippinus",
    "Motacilla cinerea",
    "Phoenicopterus roseus",
    "Lepidochelys olivacea",
    "Rhincodon typus",
)

# Poaching-sensitive species are never fetched at fine resolution.
SENSITIVE_SPECIES = frozenset({
    "Panthera tigris", "Panthera pardus", "Rhinoceros unicornis", "Manis crassicaudata",
    "Manis pentadactyla", "Ardeotis nigriceps", "Elephas maximus",
})


@dataclass(frozen=True)
class GlobalSearch:
    """Adaptive box search: count records in coarse boxes and only subdivide boxes that have any."""
    levels: tuple[int, ...] = (20, 5, 1)
