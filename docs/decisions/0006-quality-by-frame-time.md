# 0006 · Quality tiers follow measured frame time

**Status:** accepted · 2026-09-28

**Context:** Modern phones can run nearly the full effect, while older devices can't. Guessing from device names is brittle.

**Decision:** One renderer with three settings (Ultra, High, Base). Start at High on phones and Ultra on desktop. Step down only when frames run long (over 20 ms sustained), and step up again when there is headroom.

**Consequences:** Every effect must define its lower-tier fallback (see the Living Earth style guide).
