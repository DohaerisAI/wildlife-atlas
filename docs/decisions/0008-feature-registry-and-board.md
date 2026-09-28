# 0008 · The feature registry is the source of truth

**Status:** accepted · 2026-09-28

**Context:** Many parallel pieces of work make it hard to know what exists and what works. Hand-kept status goes stale.

**Decision:** One YAML file per feature in `features/`, listing the tests that prove it. On every push to `main`, CI runs the tests and computes each feature's status from the results (working, broken, or unverified when no listed test ran). It then publishes the board to GitHub Pages. Only `idea`, `planned` and `building` are set by hand.

**Consequences:** A feature isn't done until it has checks. Changing a feature means updating its YAML in the same commit.
