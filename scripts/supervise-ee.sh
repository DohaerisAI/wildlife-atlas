#!/usr/bin/env bash
# Keep a resumable Earth Engine pull alive on a flaky laptop network: restart it when no group has finished for
# STALL_S seconds (dropped DNS or connections leave its HTTP pool hung), stop when the log says DONE_MARK.
# Usage: scripts/supervise-ee.sh LOG DONE_MARK -- uv run --with earthengine-api atlas rgb-tiles --groups 4 --workers 2
set -u
LOG=$1; DONE_MARK=$2; shift 3
STALL_S=${STALL_S:-480}
cd "$(dirname "$0")/../pipeline" || exit 1
export REQUESTS_CA_BUNDLE=${REQUESTS_CA_BUNDLE:-$HOME/.certs/zscaler-ca-bundle.pem} PYTHONWARNINGS=ignore
while true; do
  "$@" >> "$LOG" 2>&1 & pid=$!
  last=$(grep -c "overall" "$LOG"); since=$(date +%s)
  while kill -0 "$pid" 2>/dev/null; do
    sleep 30
    now=$(grep -c "overall" "$LOG")
    if [ "$now" -gt "$last" ]; then last=$now; since=$(date +%s); fi
    if [ $(( $(date +%s) - since )) -gt "$STALL_S" ]; then
      echo "$(date '+%F %T') SUPERVISOR no group finished in ${STALL_S}s; restarting" >> "$LOG"
      pkill -P "$pid"; kill "$pid"; sleep 5; break
    fi
  done
  grep -q "$DONE_MARK" "$LOG" && { echo "$(date '+%F %T') SUPERVISOR done" >> "$LOG"; exit 0; }
  sleep 10
done
