#!/usr/bin/env bash
# Pull Living Earth tiles for local development (they are too big for git; see docs/plans/one-engine.md).
#   scripts/pull-tiles.sh <run-id> [set]   set = detail (world/region runs, default) or sites (town-scale site runs)
#   scripts/pull-tiles.sh                  latest successful run, detail
# Files are synced into the existing folder and the manifest is replaced last with a rename, so a running page never
# sees half a set, and the Vite dev server keeps serving the folder (renaming the folder itself makes Vite serve
# index.html for it until restarted). The engine also retries a missing manifest. World tiles (levels 0-4) and
# place names are built locally:  cd pipeline && uv run atlas tiles-world && uv run atlas places
set -euo pipefail
cd "$(dirname "$0")/.."
run="${1:-$(gh run list --workflow tiles.yml --status success --limit 1 --json databaseId -q '.[0].databaseId')}"
set_name="${2:-detail}"
[ -n "$run" ] || { echo "no successful tiles run found" >&2; exit 1; }
root=web/public/content/tiles
dest="$root/$set_name"
mkdir -p "$root"
tmp="$(mktemp -d)"  # outside public/, so Vite never lists it
gh run download "$run" --name tiles-detail --dir "$tmp"
[ -f "$tmp/manifest.json" ] || { echo "run $run has no manifest; keeping the current set" >&2; rm -rf "$tmp"; exit 1; }
mkdir -p "$dest"
rsync -a --exclude manifest.json "$tmp/" "$dest/"
mv "$tmp/manifest.json" "$dest/.manifest.json.new" && mv -f "$dest/.manifest.json.new" "$dest/manifest.json"
rm -rf "$tmp"
echo "tiles from run $run in $dest: $(find "$dest" -name '*.png' -o -name '*.jpg' | wc -l) files, $(du -sh "$dest" | cut -f1)"
