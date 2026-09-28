# 0005 · Our own globe engine for Living Earth

**Status:** accepted · 2026-09-28

**Context:** Living Earth needs per-material shaders driven by monthly data (water, snow, wind, greenness). Cesium's globe can't take custom materials at that level. MapLibre is a street-map engine.

**Decision:** Build the Living Earth renderer on three.js, targeting WebGPU with a WebGL2 fallback. It reads our own globe packs and regional tiles. Cesium stays for the realistic look until the material system surpasses it. MapLibre stays for local detail.

**Consequences:** This is the largest engineering investment and the most defensible asset. It ships in layers: globe pack first, regional tiles later.
