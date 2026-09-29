# Wildlife Atlas (prototype)

A story-first globe of where animals are through the year, and why they move. India first, ranges worldwide.

- **What works right now:** the [build board](https://dohaerisai.github.io/wildlife-atlas/board/), rebuilt from test results on every push
- **How it's built:** [`docs/architecture.md`](docs/architecture.md) and the decision records in [`docs/decisions/`](docs/decisions/)
- **What it is:** [`WILDLIFE_ATLAS_PRODUCT_SPEC.md`](WILDLIFE_ATLAS_PRODUCT_SPEC.md)

## Run with demo data

```bash
cd pipeline && uv sync && uv run atlas demo   # writes SYNTHETIC data to web/public/data
cd ../web && npm install && npm run dev       # http://localhost:5173
```

The demo bundle is invented, and the app shows a red banner while it is loaded.

## Views

| URL | View | Engine |
|---|---|---|
| `/` or `/?view=holo` | Hologram globe with particle flows and stories | three.js |
| `/?view=real` | Realistic Earth: satellite imagery, seasonal sunlight, cinematic tilt | CesiumJS |

Both globe views share one scene engine (`src/scene/`: clock, particle flow, story director). Each renderer
lives in `src/views/`. Particles show a share of a species' recorded presence, never individual animals.

Real 3D terrain in the realistic view needs a free Cesium ion token:
`echo "VITE_CESIUM_ION_TOKEN=..." > web/.env.local`. Without it the globe is smooth, with imagery only.

## Real data from your phone (no laptop or VPN bypass needed)

GBIF is blocked on the office network, so the fetch runs on GitHub's servers:

1. On your phone, open the GitHub app (or github.com) → **wildlife-atlas** → **Actions** → **Fetch GBIF data**.
2. Tap **Run workflow**, pick `smoke` (3 squares, ~5 min) or `full` (all of India + featured species worldwide, a few hours), then **Run**.
3. When it's green, run `scripts/pull-data.sh` on the work machine (GitHub is reachable from there). It unpacks the ready-to-serve
   bundle into `web/public/data` and the raw responses into `data/raw`.

If a run stops early, run it again: everything already downloaded is reused from the `data` branch.

## Real data (GBIF), running the fetch yourself

`atlas fetch` needs direct access to api.gbif.org, which the corporate proxy blocks, so run it on another network.
It makes about 4,000 small API calls, caches every response under `data/raw/gbif`, and resumes if interrupted.

```bash
cd pipeline
uv run atlas fetch          # off-VPN; India, every bird species per 1° cell (~4,000 calls, ~20-30 min)
uv run atlas fetch-global   # off-VPN; featured species worldwide (~2,000 calls per species)
uv run atlas build          # works anywhere once data/raw exists
```

Featured worldwide species live in `FEATURED_SPECIES` in `pipeline/atlas_pipeline/config.py`, and any
animal group works. Poaching-sensitive species (`SENSITIVE_SPECIES`) are refused at fine resolution.

## Layout

- `pipeline/` Python: GBIF fetch → 1° cell monthly counts → presence labels → static JSON
- `web/` Vite + TypeScript + MapLibre globe; reads `web/public/data`

## Tests

```bash
cd pipeline && uv run pytest --cov=atlas_pipeline
cd web && npm test && npm run typecheck
```
