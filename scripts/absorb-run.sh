#!/usr/bin/env bash
# Merge finished shards of a "Build Living Earth tiles" run into a served tileset, as they land (works mid-run;
# run it again to pick up more). Each shard replaces only its own tiles; the manifest is rewritten last.
#   scripts/absorb-run.sh <run-id> [set] [level]     set = sites (default) or detail; level = the run's finest level
# Files go into the existing folder (no folder renames), so the Vite dev server keeps serving them and the
# engine picks the new manifest up on its next poll.
set -euo pipefail
cd "$(dirname "$0")/.."
run="$1"; set_name="${2:-sites}"; level="${3:-11}"
dest="web/public/content/tiles/$set_name"
mkdir -p "$dest"
done_list="$dest/.absorbed"
touch "$done_list"
dirs=(); ids=()
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
while read -r id name; do
  grep -qx "$id" "$done_list" && continue
  gh run download "$run" --name "$name" --dir "$tmp/$name"
  dirs+=("$tmp/$name"); ids+=("$id")
done < <(gh api "repos/{owner}/{repo}/actions/runs/$run/artifacts" --paginate -q '.artifacts[] | select(.name | startswith("tiles-shard-")) | "\(.id) \(.name)"')
if [ ${#dirs[@]} -eq 0 ]; then echo "nothing new in run $run"; exit 0; fi
(cd pipeline && uv run python scripts/tiles_ci.py absorb "../$dest" "${dirs[@]}" --name "$set_name" --level "$level")
printf '%s\n' "${ids[@]}" >> "$done_list"  # only once they are in
