#!/usr/bin/env bash
# Pull real data fetched by the GitHub workflow into this checkout.
#   web/public/data  ← ready-to-serve bundle (replaces the demo data)
#   data/raw         ← raw GBIF responses, so `atlas build` can be re-run locally with new rules
set -euo pipefail
cd "$(dirname "$0")/.."
git fetch --quiet origin data || { echo "No data branch on origin yet. Run the 'Fetch GBIF data' workflow first." >&2; exit 1; }
git show FETCH_HEAD:raw.tar.gz | tar xz
mkdir -p web/public
git show FETCH_HEAD:bundle.tar.gz | tar xz -C web/public
git show FETCH_HEAD:README.md | sed -n '3p'
echo "Pulled into data/raw and web/public/data. Reload the app."
