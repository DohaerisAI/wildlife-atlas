"""classify.py for millions of species-cells at once with numpy. Same rules, same labels (tests compare)."""

from dataclasses import dataclass

import numpy as np

from .classify import Presence
from .config import MONTHS, ClassifyRules

LABELS = (Presence.RESIDENT.value, Presence.SEASONAL.value, Presence.PASSAGE.value, Presence.UNCERTAIN.value)
RESIDENT, SEASONAL, PASSAGE, UNCERTAIN = range(4)


@dataclass(frozen=True)
class Classified:
    rates: np.ndarray    # (n, 12) float64, record share per month
    present: np.ndarray  # (n, 12) bool, month counts as present
    label: np.ndarray    # (n,) int8 index into LABELS


def max_circular_run(flags: np.ndarray) -> np.ndarray:
    """Longest run of True per row, with December next to January (capped at 12)."""
    doubled = np.concatenate([flags, flags], axis=1)
    run = np.zeros(flags.shape[0], dtype=np.int16)
    best = np.zeros_like(run)
    for j in range(doubled.shape[1]):
        run = np.where(doubled[:, j], run + 1, 0).astype(np.int16)
        best = np.maximum(best, run)
    return np.minimum(best, MONTHS)


def classify_many(counts: np.ndarray, totals: np.ndarray, rules: ClassifyRules = ClassifyRules()) -> Classified:
    if counts.shape != totals.shape or counts.ndim != 2 or counts.shape[1] != MONTHS:
        raise ValueError(f"counts and totals must both be (n, {MONTHS}); got {counts.shape} and {totals.shape}")
    c = counts.astype(np.float64)
    t = totals.astype(np.float64)
    with np.errstate(divide="ignore", invalid="ignore"):
        rates = np.where(t > 0, c / np.where(t > 0, t, 1.0), 0.0)
    peak = rates.max(axis=1)
    present = (counts > 0) & (rates >= (rules.rel_presence * peak)[:, None]) & (peak > 0)[:, None]

    adequate = totals >= rules.min_month_effort
    uncertain = (adequate.sum(axis=1) < rules.min_adequate_months) | (counts.sum(axis=1) < rules.min_species_records)
    resident = (adequate & ~present).sum(axis=1) <= rules.resident_max_absent
    run = max_circular_run(present)
    passage = (present.sum(axis=1) <= rules.passage_max_months) & (run >= 1) & (run <= rules.passage_max_run)

    label = np.full(counts.shape[0], SEASONAL, dtype=np.int8)
    label[passage] = PASSAGE
    label[resident] = RESIDENT
    label[uncertain] = UNCERTAIN
    return Classified(rates, present, label)
