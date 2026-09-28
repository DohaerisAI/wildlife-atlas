# 0004 · The living layer stops at about 100 m

**Status:** accepted · 2026-09-28

**Context:** A fine-zoom global environment layer would run to terabytes. Habitat stops meaning anything below about 100 m.

**Decision:** Three depths. Globe: one ~25 MB global pack. Region: tiles from 1 km to 150 m, generated per region. Local: past about zoom 11, hand over to the MapLibre street map and fade the living layer to a tint.

**Consequences:** Storage stays in gigabytes, not terabytes. Regional packs are built on demand, India first.
