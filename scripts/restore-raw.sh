#!/usr/bin/env bash
# Unpack previously fetched raw GBIF responses from the `data` branch (if any) so fetches resume.
set -euo pipefail
cd "$(dirname "$0")/.."
if git fetch --quiet --depth 1 origin data 2>/dev/null; then
  git show FETCH_HEAD:raw.tar.gz | tar xz
  echo "Restored $(find data/raw -type f | wc -l) cached responses"
else
  echo "No data branch yet; starting fresh"
fi
