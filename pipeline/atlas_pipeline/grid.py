"""Fixed-degree grid cells identified by their south-west corner, e.g. '10_76'."""

from dataclasses import dataclass

from .config import Region


@dataclass(frozen=True)
class Cell:
    lat0: float
    lng0: float
    size: float

    @property
    def id(self) -> str:
        return f"{_fmt(self.lat0)}_{_fmt(self.lng0)}"

    @property
    def center(self) -> tuple[float, float]:
        half = self.size / 2
        return (self.lat0 + half, self.lng0 + half)

    def ring(self) -> list[list[float]]:
        """Closed GeoJSON ring in [lng, lat] order."""
        s, w, n, e = self.lat0, self.lng0, self.lat0 + self.size, self.lng0 + self.size
        return [[w, s], [e, s], [e, n], [w, n], [w, s]]


def _fmt(value: float) -> str:
    return f"{value:g}"


def region_cells(region: Region) -> list[Cell]:
    size = region.cell_deg
    rows = round((region.lat_max - region.lat_min) / size)
    cols = round((region.lng_max - region.lng_min) / size)
    return [
        Cell(region.lat_min + r * size, region.lng_min + c * size, size)
        for r in range(rows)
        for c in range(cols)
    ]


def parse_cell_id(cell_id: str, size: float) -> Cell:
    try:
        lat, lng = (float(part) for part in cell_id.split("_"))
    except ValueError as exc:
        raise ValueError(f"Invalid cell id: {cell_id!r}") from exc
    return Cell(lat, lng, size)
