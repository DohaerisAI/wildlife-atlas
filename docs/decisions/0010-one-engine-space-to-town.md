# 0010 · One engine from space to town, on our own data

**Status:** accepted · 2026-09-29 (extends 0005, refines 0004)

**Context:** The atlas hands the three.js globe over to a MapLibre street map at ~1,300 km. However well the colours match, the swap is felt, the globe goes blocky just before it (10 km land pixels), and the look splits in two: bloom, particles and the free camera exist only on the globe. MapLibre could host our layers but not screen-wide bloom, a free camera or the hologram. zoom.earth shows the alternative: one custom WebGL surface at every zoom.

**Decision:** Build one renderer on three.js that goes from the whole planet to a town (~map zoom 13) with no hand-over:
- a quadtree of tiles on the sphere, fed by our own tile pyramids (Living Earth land, water, snow, greenness, relief; coarse worldwide, fine for India first);
- our own place labels from an open place list (GeoNames / Natural Earth), in our fonts and priorities;
- roads as raster tiles blended in at close zoom, not a vector street engine (0004: no street level);
- particles, wind, currents, bloom and the camera as today.
MapLibre is removed once this reaches parity. Every layer is built as data we own (pipeline → PMTiles → engine), so the same products feed stories, the atlas, research downloads and partners.

**Consequences:** We maintain a tile system and a label system ourselves. In return we keep full control of the look, one code path, and a growing data asset. Build order and checks: `docs/plans/one-engine.md`.
