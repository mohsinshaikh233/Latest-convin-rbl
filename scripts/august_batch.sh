#!/usr/bin/env bash
# Build a batch of August reports. Resumable: build_august_local.mjs skips any book
# whose PDF already exists, so this can be re-run until the count reaches 36.
#
#   bash scripts/august_batch.sh <how-many-this-run>
#
# Runs the dev server on the roomy /tmp toolchain (the sandbox's /sessions device is
# full), then tears it down so the next invocation starts clean.
set -u
N="${1:-6}"
cd "$(dirname "$0")/.."
export TMPDIR=/tmp TMP=/tmp TEMP=/tmp
export LD_LIBRARY_PATH=/tmp/xstub PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers npm_config_cache=/tmp/npmcache
ulimit -n 65535
OUT=/tmp/reports_out; mkdir -p "$OUT"

DATABASE_URL= ./node_modules/.bin/next dev -p 3111 > /tmp/next.log 2>&1 &
SRV=$!
for i in $(seq 1 30); do
  sleep 2
  c=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3111/convin/dashboard 2>/dev/null)
  [ "$c" = "200" ] && break
done
[ "$c" = "200" ] || { echo "SERVER FAILED"; tail -8 /tmp/next.log; kill $SRV 2>/dev/null; exit 1; }

DATABASE_URL= node --max-old-space-size=3072 scripts/build_august_local.mjs \
  --plan /tmp/plan.json --out "$OUT" --limit "$N" 2>&1 | grep -vE '^SKIP'

kill $SRV 2>/dev/null
echo "total PDFs: $(ls "$OUT"/*.pdf 2>/dev/null | wc -l) / 36"
