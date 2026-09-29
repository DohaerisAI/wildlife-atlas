# One engine, space to town (decision 0010)

**Status:** planned · 2026-09-29

## Done looks like
Zoom from the whole planet to Pune or Satna in one motion, sharper all the way, same look throughout, with town names and roads appearing as you get close. No Street map button, no swap. Phones stay above 30 fps.

## Build order
1. **Prototype (1–2 days).** Quadtree tiles on the three.js globe (evaluate `geo-three` first, else our own), fed by India Living Earth tiles at 1 km; our own labels from a GeoNames extract; space to Pune in one motion. Go / no-go on feel and frame time.
2. **Tile pipeline.** Earth Engine → tile pyramids (land class + tree + hillshade, 12 monthly water/snow/NDVI) → PMTiles on Cloudflare R2, each with a manifest (architecture rule). World to ~2 km, India to ~150 m.
3. **Labels.** Places (GeoNames cities ≥ 1,000 people for India, larger elsewhere) as a small data product; SDF text in Fraunces / JetBrains Mono; priority by population and zoom; collision in screen space.
4. **Roads.** Dark raster road tiles (rendered from OSM by us, or a permitted provider) blended in below ~50 km.
5. **Move the atlas.** Street-map features (place pin, species wash, selected square, locate me, search fly-to) onto the engine; remove MapLibre and `map-view.ts`.
6. **Regional depth.** Finer tiles for each story's region; observation clusters where permitted.

## Data we own at the end
Living Earth tile pyramids (global + India), place names with our priorities, road rasters, species grids and profiles: every one with a manifest, version and source, reusable across the product and for research.
