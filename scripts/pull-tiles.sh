#!/usr/bin/env bash
# Pull Living Earth tiles for local development (they are too big for git; see docs/plans/one-engine.md).
#   scripts/pull-tiles.sh <run-id>     detail tiles from a "Build Living Earth tiles" run -> web/public/content/tiles/detail
#   scripts/pull-tiles.sh              latest successful run
# World tiles (levels 0-4) and place names are built locally: cd pipeline && uv run atlas tiles-world && uv run atlas places
set -euo pipefail
cd "$(dirname "$0")/.."
run="${1:-$(gh run list --workflow tiles.yml --status success --limit 1 --json databaseId -q '.[0].databaseId')}"
[ -n "$run" ] || { echo "no successful tiles run found" >&2; exit 1; }
dest=web/public/content/tiles/detail
tmp="$(mktemp -d)"
gh run download "$run" --name tiles-detail --dir "$tmp"
rm -rf "$dest.old"; [ -d "$dest" ] && mv "$dest" "$dest.old"
mkdir -p "$(dirname "$dest")" && mv "$tmp" "$dest" && rm -rf "$dest.old"
echo "tiles from run $run in $dest: $(find "$dest" -name '*.png' | wc -l) files, $(du -sh "$dest" | cut -f1)"
