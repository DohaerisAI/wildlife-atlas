import pytest

from atlas_pipeline.classify import (
    Coverage,
    Presence,
    circular_runs,
    classify,
    coverage,
    monthly_rates,
)
from atlas_pipeline.config import ClassifyRules, CoverageRules

RULES = ClassifyRules()
FULL_EFFORT = [100] * 12


def test_rates_divide_and_guard_zero_totals():
    counts = [10] + [0] * 11
    totals = [100] + [0] * 11
    assert monthly_rates(counts, totals)[:2] == (0.1, 0.0)


def test_wrong_length_rejected():
    with pytest.raises(ValueError, match="12 monthly"):
        monthly_rates([1, 2], [1, 2])


def test_resident_present_all_year():
    assert classify([20] * 12, FULL_EFFORT, RULES) is Presence.RESIDENT


def test_resident_tolerates_one_gap():
    counts = [20] * 11 + [0]
    assert classify(counts, FULL_EFFORT, RULES) is Presence.RESIDENT


def test_winter_visitor_wrapping_year_end_is_seasonal():
    # Oct-Mar present, e.g. Bar-headed Goose on northern wetlands
    counts = [30, 30, 20, 0, 0, 0, 0, 0, 0, 10, 25, 30]
    assert classify(counts, FULL_EFFORT, RULES) is Presence.SEASONAL


def test_passage_short_peaks():
    # Amur Falcon in Nagaland: a brief autumn peak only
    counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 40, 30, 0]
    assert classify(counts, FULL_EFFORT, RULES) is Presence.PASSAGE


def test_spring_and_autumn_passage():
    counts = [0, 0, 0, 15, 0, 0, 0, 0, 20, 10, 0, 0]
    assert classify(counts, FULL_EFFORT, RULES) is Presence.PASSAGE


def test_weak_months_below_relative_floor_are_not_presence():
    # one stray record in summer does not break the winter-only label
    counts = [30, 30, 20, 0, 0, 1, 0, 0, 0, 10, 25, 30]
    assert classify(counts, FULL_EFFORT, RULES) is Presence.SEASONAL


def test_low_effort_is_uncertain():
    totals = [100, 100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 100]
    assert classify([5] * 12, totals, RULES) is Presence.UNCERTAIN


def test_too_few_species_records_is_uncertain():
    counts = [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]
    assert classify(counts, FULL_EFFORT, RULES) is Presence.UNCERTAIN


def test_rates_not_raw_counts_drive_presence():
    # counts look seasonal only because effort spikes in winter
    counts = [50, 50, 5, 5, 5, 5, 5, 5, 5, 5, 50, 50]
    totals = [1000, 1000, 100, 100, 100, 100, 100, 100, 100, 100, 1000, 1000]
    assert classify(counts, totals, RULES) is Presence.RESIDENT


@pytest.mark.parametrize(
    "flags,expected",
    [
        ([True] * 12, [12]),
        ([False] * 12, []),
        ([True, True] + [False] * 8 + [True, True], [4]),
        ([False, True, False, True, True] + [False] * 7, [1, 2]),
    ],
)
def test_circular_runs(flags, expected):
    assert sorted(circular_runs(flags)) == sorted(expected)


@pytest.mark.parametrize("total,expected", [(900, Coverage.WELL), (60, Coverage.SOME), (3, Coverage.LIMITED)])
def test_coverage(total, expected):
    assert coverage(total, CoverageRules()) is expected
