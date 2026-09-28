# 0001 · Static first, no backend

**Status:** accepted · 2026-09-25

**Context:** The project is free and noncommercial. Most of what we show is precomputed from monthly data that changes slowly.

**Decision:** Precompute every product in the pipeline and serve it as static files: the web build, species bundles, and tile packs on R2. We add a server only when a feature can't work without one (accounts, native observations, a live query API).

**Consequences:** Hosting costs almost nothing and outages are rare. All heavy work moves to build time (GitHub Actions). Interactive research queries will need a later decision.
