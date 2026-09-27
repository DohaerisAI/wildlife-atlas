from atlas_pipeline.classify import Presence, classify
from atlas_pipeline.config import ClassifyRules
from atlas_pipeline.demo import demo_cells, demo_names


def test_demo_covers_india_and_is_deterministic():
    a, b = demo_cells(), demo_cells()
    assert 200 < len(a) < 450
    assert a == b
    assert set(demo_names()) >= {"demo-falamu", "demo-pavcri"}


def test_demo_patterns_classify_as_intended():
    cells = {c.id: c for c in demo_cells()}
    rules = ClassifyRules()
    kerala = cells["10_76"]
    assert classify(kerala.species["demo-pavcri"], kerala.totals, rules) is Presence.RESIDENT
    nagaland = cells["25_93"]
    assert classify(nagaland.species["demo-falamu"], nagaland.totals, rules) is Presence.PASSAGE
