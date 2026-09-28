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
| L3 Engine: stage + tiers, globe, layers, story runtime | `web/src/engine/{core,globe,layers}/`, `web/src/story/`, older views in `web/src/views/`, `web/src/scene/` |
| L4 Experiences: story front door, atlas, map | `web/index.html` + `web/src/experiences/story-page.ts` + `web/src/stories/`; `atlas.html` (holo/real); `map.html` |

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
- `maplibre-gl` v6 must stay in Vite `optimizeDeps.exclude`, or its worker URL breaks. Add MapLibre layers on `style.load`, not `load`.
- Cesium needs `CESIUM_BASE_URL` plus the `postinstall` copy of its assets. The ion token lives in `web/.env.local` (`VITE_CESIUM_ION_TOKEN`) and is never committed.
- The flow engine anchors monthly data at mid-month (`t = month + 0.5`).
- Stories are data (`web/src/story/schema.ts`): every chapter must set the same channels; `validateStory` enforces it. New stories need no engine code.
- Facts in stories need a source; tests assert it. Illustrative routes must say so in the chapter note.
- `write_bundle` rewrites files in place so a running dev server keeps serving them.

## Commands
- Pipeline: `cd pipeline && uv run pytest`; `uv run atlas demo | build | fetch | fetch-global`
- Web: `cd web && npm test && npm run typecheck && npm run build`; dev server via `npx vite --port 5317`
- Board: `uv run tools/board/build_board.py --features features --reports reports --out site`
