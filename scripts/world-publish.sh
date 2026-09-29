#!/usr/bin/env bash
# CI helper for world-birds.yml: rebuild the world bundle from data/world and upload it to the release.
set -euo pipefail
cd "$(dirname "$0")/.."
shard="$1"
(cd pipeline && uv run atlas world-build)
tar czf bundle.tar.gz -C data/world bundle
cp data/world/bundle/coverage.json coverage.json
assets=(bundle.tar.gz coverage.json)
for f in data/world/names.json data/world/aves-checklist.json; do [ -e "$f" ] && assets+=("$f"); done
gh release upload "$TAG" -R "$GITHUB_REPOSITORY" --clobber "${assets[@]}"
{
  echo "### World birds: $shard published"
  echo "- files: $(find data/world/bundle -type f | wc -l), size: $(du -sh data/world/bundle | cut -f1), gzipped: $(du -h bundle.tar.gz | cut -f1)"
  python3 -c "import json; c=json.load(open('coverage.json')); print('- loaded: ' + ', '.join(r['name'] for r in c['regions'] if r['status']=='loaded'))"
  python3 -c "import json; s=json.load(open('data/world/bundle/species.json')); print('- species:', len(s), ' named:', sum(1 for x in s if x['name']!=x['sci']), ' cells:', len(json.load(open('data/world/bundle/cells.json'))['cells']))"
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
