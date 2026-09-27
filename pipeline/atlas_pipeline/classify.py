"""Seasonal presence labels for one species in one cell, from monthly record counts."""

from collections.abc import Sequence
from enum import Enum

from .config import MONTHS, ClassifyRules, CoverageRules


class Presence(str, Enum):
    RESIDENT = "resident"
    SEASONAL = "seasonal"
    PASSAGE = "passage"
    UNCERTAIN = "uncertain"


class Coverage(str, Enum):
    WELL = "well"
    SOME = "some"
    LIMITED = "limited"


def monthly_rates(counts: Sequence[int], totals: Sequence[int]) -> tuple[float, ...]:
    _check_len(counts, "counts")
    _check_len(totals, "totals")
    return tuple(c / t if t > 0 else 0.0 for c, t in zip(counts, totals))


def present_months(
    counts: Sequence[int], totals: Sequence[int], rules: ClassifyRules
) -> tuple[bool, ...]:
    rates = monthly_rates(counts, totals)
    peak = max(rates)
    if peak == 0:
        return (False,) * MONTHS
    floor = rules.rel_presence * peak
    return tuple(c > 0 and r >= floor for c, r in zip(counts, rates))


def classify(counts: Sequence[int], totals: Sequence[int], rules: ClassifyRules) -> Presence:
    adequate = tuple(t >= rules.min_month_effort for t in totals)
    if sum(adequate) < rules.min_adequate_months or sum(counts) < rules.min_species_records:
        return Presence.UNCERTAIN

    present = present_months(counts, totals, rules)
    absent_surveyed = sum(1 for a, p in zip(adequate, present) if a and not p)
    if absent_surveyed <= rules.resident_max_absent:
        return Presence.RESIDENT

    runs = circular_runs(present)
    if sum(present) <= rules.passage_max_months and runs and max(runs) <= rules.passage_max_run:
        return Presence.PASSAGE
    return Presence.SEASONAL


def circular_runs(flags: Sequence[bool]) -> list[int]:
    """Lengths of consecutive True runs, treating December and January as adjacent."""
    if all(flags):
        return [len(flags)]
    start = next(i for i, f in enumerate(flags) if not f)
    rotated = list(flags[start:]) + list(flags[:start])
    runs, current = [], 0
    for flag in rotated:
        if flag:
            current += 1
        elif current:
            runs.append(current)
            current = 0
    if current:
        runs.append(current)
    return runs


def coverage(total_records: int, rules: CoverageRules) -> Coverage:
    if total_records >= rules.well:
        return Coverage.WELL
    if total_records >= rules.some:
        return Coverage.SOME
    return Coverage.LIMITED


def _check_len(values: Sequence[int], name: str) -> None:
    if len(values) != MONTHS:
        raise ValueError(f"{name} must have {MONTHS} monthly values, got {len(values)}")
