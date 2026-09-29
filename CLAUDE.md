# Wildlife Atlas

A story-first globe showing where animals are through the year and why they move. Launch focus is India, with ranges followed worldwide.
Audiences: enthusiasts, students, researchers. What the product is lives in `WILDLIFE_ATLAS_PRODUCT_SPEC.md`.

## Where to look first
- `features/*.yaml`: what exists and whether it works (source of truth). Live board: https://dohaerisai.github.io/wildlife-atlas/board/
- `docs/architecture.md`: the five layers and the contracts between them.
- `docs/decisions/`: why things are the way they are. Read before reversing any of them.
- `docs/sessions/`: latest session notes, what changed and what's next.

## Layers
| Layer | Code |
|---|---|
| L0 Sources: GBIF, Earth Engine, tracking | `pipeline/atlas_pipeline/gbif_*.py`, `.github/workflows/fetch-data.yml` |
| L1 Models: seasonal presence, connectivity, gaps | `pipeline/atlas_pipeline/classify.py`, `global_ranges.py` |
| L2 Products: static bundles, tiles, manifests | `pipeline/atlas_pipeline/export.py` → `web/public/data` |
| L3 Engine: stage + tiers, globe, layers, Living Earth, story runtime | `web/src/engine/{core,globe,layers,living-earth,tiles,labels,camera}/`, `web/src/story/`, flow model in `web/src/scene/` |
| L4 Experiences: story front door, atlas | `web/index.html` + `web/src/experiences/story-page.ts` + `web/src/stories/`; `atlas.html` + `web/src/atlas/` (one tiled engine from space to town); `engine.html` (engine prototype + debug HUD) |

## Rules
- Every moving or coloured property on the globe is bound to a named dataset and month. If it can't be sourced, it doesn't move (Living Earth "Real" law).
- Particles show a share of a species' recorded presence, never individual animals. Tracked individuals are separate and labelled.
- `SENSITIVE_SPECIES` (config.py) are never fetched or shown at fine resolution.
- Synthetic demo data stays flagged `demo: true` and shows a banner. Never present it as evidence.
- When you add or change a feature, update its `features/<id>.yaml` and point `checks` at tests that prove it.
- Commits: conventional commits, the repo-local git identity, no AI attribution trailers.

## Gotchas
- The dev laptop's proxy blocks GBIF, eBird, iNaturalist and Movebank. Fetches run on GitHub Actions; pull results with `scripts/pull-data.sh` or `gh run download`.
- GBIF: send coordinates in fixed-point (`-1e-06` gets HTTP 400). HTTP 429 means back off for minutes and run one job at a time. SQL downloads support `FLOOR()` grids but not `GBIF_EQDGCCode`, and a valid query returns 201.
- Transferring the repo to a new owner cancels in-progress Actions runs.
- Tiles (`web/public/content/tiles/`) and place names (`web/public/content/places/`) are not in git: `uv run atlas tiles-world`, `uv run atlas places`, then `scripts/pull-tiles.sh` or `scripts/absorb-run.sh <run-id>`. Never rename a folder under `web/public` while Vite runs (it serves index.html for it until restarted); write files inside, manifest last.
- The flow engine anchors monthly data at mid-month (`t = month + 0.5`).
- Stories are data (`web/src/story/schema.ts`): every chapter must set the same channels; `validateStory` enforces it. New stories need no engine code.
- Facts in stories need a source; tests assert it. Illustrative routes must say so in the chapter note.
- Earth Engine: coarse pyramid levels of masked data (JRC water) average only unmasked pixels. Weight by the fractional `mask()` to get a cell-wide share (`living_earth.water_share`).
- `write_bundle` rewrites files in place so a running dev server keeps serving them.

## Commands
- Pipeline: `cd pipeline && uv run pytest`; `uv run atlas demo | build | fetch | fetch-global`
- Web: `cd web && npm test && npm run typecheck && npm run build`; dev server via `npx vite --port 5317`
- Board: `uv run tools/board/build_board.py --features features --reports reports --out site`
