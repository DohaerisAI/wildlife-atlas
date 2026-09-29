#!/usr/bin/env bash
# Pull the worldwide bird bundle published by the "World birds" workflow (release `world-birds`).
#   data/world/bundle   every loaded region (coverage.json lists which), same layout as web/public/data
#   --use               also point web/public/data at it (the India bundle from pull-data.sh is kept aside)
#   --shards            also pull the per-shard parquet tables, so `atlas world-build` can run locally
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/world
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
gh release download world-birds -D "$tmp" -p bundle.tar.gz -p coverage.json -p names.json \
  || { echo "No world-birds release yet. Run the 'World birds' workflow first." >&2; exit 1; }
rm -rf data/world/bundle && tar xzf "$tmp/bundle.tar.gz" -C data/world
cp "$tmp/names.json" data/world/ 2>/dev/null || true
if [[ " $* " == *" --shards "* ]]; then
  gh release download world-birds -D "$tmp" -p 'shard-*.tar.gz' --clobber
  for f in "$tmp"/shard-*.tar.gz; do tar xzf "$f" -C data/world; done
fi
python3 -c "import json; c=json.load(open('data/world/bundle/coverage.json')); print('loaded:', ', '.join(r['name'] for r in c['regions'] if r['status']=='loaded') or 'none')"
echo "bundle: $(find data/world/bundle -type f | wc -l) files, $(du -sh data/world/bundle | cut -f1) in data/world/bundle"
if [[ " $* " == *" --use "* ]]; then
  if [ -d web/public/data ] && [ ! -L web/public/data ]; then rm -rf web/public/data.india && mv web/public/data web/public/data.india; fi
  ln -sfn ../../data/world/bundle web/public/data
  echo "web/public/data now points at the world bundle (India bundle kept in web/public/data.india)."
fi
