#!/bin/sh
# The gateway core imported by CLAUDE.md stays small (issue 337) and keeps the Master Data rule (issue 156);
# the detail files exist and CLAUDE.md names them.   From the repo root: device/edge/tests/gateway-core.sh
set -eu
cd "$(dirname "$0")/../../.."
fail=0
n=$(wc -c < docs/gateway.md)
[ "$n" -le 4096 ] || { echo "FAIL docs/gateway.md is $n bytes (max 4096)"; fail=1; }
grep -q '/var/lib/sumisura/data' docs/gateway.md && grep -qi 'before asking the owner' docs/gateway.md || { echo "FAIL Master Data rule missing from docs/gateway.md"; fail=1; }
grep -q '^@docs/gateway.md$' CLAUDE.md || { echo "FAIL CLAUDE.md does not import docs/gateway.md"; fail=1; }
for f in gateway-projects gateway-ci; do
	[ -s "docs/$f.md" ] || { echo "FAIL docs/$f.md missing"; fail=1; }
	grep -q "docs/$f.md" CLAUDE.md || { echo "FAIL CLAUDE.md does not name docs/$f.md"; fail=1; }
done
[ "$fail" = 0 ] && echo "ok gateway-core"
exit "$fail"
