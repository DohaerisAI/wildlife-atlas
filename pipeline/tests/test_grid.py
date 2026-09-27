import pytest

from atlas_pipeline.config import Region
from atlas_pipeline.grid import Cell, parse_cell_id, region_cells


def test_cell_id_and_center():
    cell = Cell(10, 76, 1.0)
    assert cell.id == "10_76"
    assert cell.center == (10.5, 76.5)


def test_half_degree_ids():
    assert Cell(10.5, 76, 0.5).id == "10.5_76"


def test_ring_is_closed_lng_lat():
    ring = Cell(10, 76, 1.0).ring()
    assert ring[0] == ring[-1] == [76, 10]
    assert [77, 11] in ring


def test_region_cells_count():
    cells = region_cells(Region("IN", 6, 8, 68, 71, 1.0))
    assert len(cells) == 6
    assert {c.id for c in cells} >= {"6_68", "7_70"}


def test_parse_roundtrip():
    assert parse_cell_id("-3.5_120", 0.5) == Cell(-3.5, 120, 0.5)


def test_parse_rejects_garbage():
    with pytest.raises(ValueError):
        parse_cell_id("abc", 1.0)
