# One engine, space to town (decision 0010)

**Status:** planned · 2026-09-29

## Done looks like
Zoom from the whole planet to Pune or Satna in one motion, sharper all the way, same look throughout, with town names and roads appearing as you get close. No Street map button, no swap. Phones stay above 30 fps.

## Build order
1. **Prototype (1–2 days, done 2026-09-29).** Our own quadtree tiles on the three.js globe (`geo-three` evaluated and rejected: Web Mercator only, one texture per node, no custom shader), fed by world tiles and the first detail levels; our own labels from GeoNames worldwide; space to Pune, Satna and the Serengeti in one motion. Go / no-go on feel and frame time: `docs/sessions/2026-09-29-engine.md`.
2. **Tile pipeline.** Earth Engine → tile pyramids (land class + tree + hillshade, 12 monthly NDVI; water/snow next) → Cloudflare R2, each tileset with a manifest and availability index (architecture rule). The whole world at one detail: level 6 (~1.2 km) everywhere first, then 7 and 8 (~300 m), then 9+ (~150 m and finer). `.github/workflows/tiles.yml` runs it as a matrix of level-3 shards (114 with land), skips open ocean, and resumes with `gh run rerun --failed`.
3. **Labels.** Places (GeoNames cities ≥ 1,000 people, worldwide: 171k places, major ones up front and the rest in 22.5° chunks) as a small data product; Fraunces labels (HTML now, SDF if counts grow); priority by population, capitals and admin seats; collision in screen space.
4. **Roads.** Dark raster road tiles (rendered from OSM by us, or a permitted provider) blended in below ~50 km.
5. **Move the atlas.** Street-map features (place pin, species wash, selected square, locate me, search fly-to) onto the engine; remove MapLibre and `map-view.ts`.
6. **Regional depth.** Finer tiles for each story's region; observation clusters where permitted.

## Data we own at the end
Living Earth tile pyramids (the whole world at one detail), place names with our priorities, road rasters, species grids and profiles: every one with a manifest, version and source, reusable across the product and for research.

## Tile data: size and hosting
Land-bearing tiles (from pack v2's land mask, grown one pixel): level 5 1,107 · 6 3,748 · 7 13,342 · 8 49,329, so ~67,500 tiles for levels 5–8. A tile is a 256 px land PNG plus a 4 × 3 NDVI atlas, ~60–100 KB together: **~4–7 GB for the world to ~300 m**, ~4x more for each further level (level 9 adds ~200k tiles, ~15–20 GB). World levels 0–4 cut from pack v2 are 27 MB.

That is too big for git and for Actions artifacts beyond their 14-day retention, so tiles live on **Cloudflare R2** (free egress; 10 GB free storage covers levels 5–8). **Blocker: needs the owner's Cloudflare account.** Setup:
1. Cloudflare dashboard → R2 → enable R2 (asks for a payment method even on the free tier).
2. Create bucket `wildlife-atlas-tiles`.
3. R2 → Manage API tokens → Create token, permission *Object Read & Write*, scoped to that bucket. Note the Access Key ID, Secret Access Key and the account ID.
4. Repo secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. The tiles workflow's merge job then syncs `tiles/detail/` to the bucket (the step is already in `tiles.yml` and skips itself until the secrets exist).
5. Public read: bucket → Settings → connect a custom domain (e.g. `tiles.<our domain>`; the `r2.dev` URL is rate-limited and for testing only), and add a CORS rule allowing `GET` from the GitHub Pages origin and `http://localhost:5317`.
6. Build the web with `VITE_TILES_BASE=https://tiles.<our domain>/tiles/` so the engine reads from R2.

Until then, development pulls tiles locally: `scripts/pull-tiles.sh <run-id>` (detail, from the workflow artifact) and `cd pipeline && uv run atlas tiles-world && uv run atlas places` (world levels and place names), all into gitignored folders under `web/public/content/`. PMTiles later: our level z maps to PMTiles zoom z+1 (its square grid holds our 2:1 grid), so the directory layout converts without re-computing.
