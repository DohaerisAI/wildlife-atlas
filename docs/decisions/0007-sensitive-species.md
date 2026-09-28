# 0007 · Sensitive species are never shown precisely

**Status:** accepted · 2026-09-28

**Context:** Exact locations of poached species (tigers, rhinos, pangolins, great Indian bustards) can put animals at risk.

**Decision:** `SENSITIVE_SPECIES` in `config.py` are refused by the fine-resolution fetch. Any future display of them is region-level only, and that change needs its own decision record.

**Consequences:** Some famous animals appear only as coarse regional glow. That is deliberate.
