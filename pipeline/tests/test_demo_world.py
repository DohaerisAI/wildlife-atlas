from atlas_pipeline.demo import demo_cells
from atlas_pipeline.demo_world import demo_world_ranges


def test_world_ranges_skip_india_and_ocean():
    india = {c.id for c in demo_cells()}
    ranges = {r.key: r for r in demo_world_ranges(exclude=india)}
    falcon = ranges["demo-falamu"].cells
    assert not india & set(falcon)
    assert "-25_28" in falcon  # South Africa, December
    assert falcon["-25_28"][0][11] > 0 and falcon["-25_28"][0][6] == 0
    assert "-10_60" not in falcon  # Indian Ocean
    assert all(sum(counts) > 0 for counts, _ in falcon.values())
