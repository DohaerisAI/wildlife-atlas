# 2026-09-30 · Every bird worldwide, region by region

## What changed
- **World birds pipeline** (`world_shards.py`, `gbif_sql.py`, `world_ingest.py`, `bird_names.py`, `world_bundle.py`, `classify_vec.py`).
  Six region shards tile the globe on whole degrees, in publishing order: South Asia, Africa and Arabia,
  Europe and the Middle East, East/Southeast/North Asia, the Americas, Oceania. There is one GBIF SQL download per shard:
  Aves, PRESENT, coordinates with no geospatial issues, 2010–2026, grouped by species, `FLOOR` 1° cell and month.
  Genus-level rows are kept as effort only. Sensitive species are excluded in the SQL itself (decision 0007).
- **Resumable downloads.** The key is saved as soon as GBIF accepts the query. It is also uploaded as a release asset
  (`download-<shard>.json`). Before resubmitting, the job looks through the user's downloads for an identical query.
  A run that hits the wait limit exits with code 3 and the next run picks the same download up.
- **Names** are joined by scientific name (decision 0002). They come from the GBIF backbone checklist of Aves
  (paged species search), and `species/match` fills the gaps. Keys stay the backbone's integer keys, like the India bundle,
  so gbif.org links and profiles keep working. Names that can't be matched keep their SQL key and are never dropped.
- **Bundle.** Same layout the atlas reads today, plus `coverage.json`, a manifest that marks each region loaded or pending
  and gives its records, cells, species and DOI. The bundle is rebuilt from all shard tables every time.
  Unchanged files are left alone and stale ones are removed, so re-running one shard replaces only that shard.
  A benchmark of 1M species-cells took 5 s and produced 180 MB.
- **Workflow** `world-birds.yml`: one shard at a time. Each shard validates its SQL, then downloads, ingests,
  publishes `shard-<id>.tar.gz`, resolves names, and rebuilds and publishes `bundle.tar.gz` + `coverage.json`
  on the `world-birds` release.
- **Atlas.** The place panel's "no species list" note comes from `coverage.json`. Old bundles fall back to "India".
  "In India" in species journeys now uses `web/public/geo/india-cells.json` (the 397 India-country cells),
  not "any cell with a list".
- `atlas profiles --all --species-json data/world/bundle/species.json` runs profiles for the world list.

## How to use it
- Run the workflow: Actions → World birds (all shards, or a comma list; `refresh` downloads again).
- Pull the data: `scripts/pull-world.sh` (bundle), `--shards` (parquet, for a local `atlas world-build`),
  `--use` (points `web/public/data` at the world bundle and keeps the India bundle as `web/public/data.india`).

## Next
- Host the bundle on Cloudflare R2 like the tiles (needs the owner's account). The release asset is the interim home;
  GitHub allows up to 2 GB per asset.
- Atlas follow-ups (engine agent owns app.ts):
  - `cells.json` grows to tens of thousands of cells. Consider splitting it per shard or loading it lazily.
  - The research "Grid cell" bounds print `°N/°E` even for southern and western cells.
  - The default species and search ranking assume India.
- SENSITIVE_SPECIES is India-centric. A global review should add trafficked birds (e.g. Helmeted Hornbill,
  Straw-headed Bulbul, African Grey Parrot). Changing the list changes the SQL, so the next run re-downloads.
