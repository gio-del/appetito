#!/bin/sh
# History charts of the dashboard in headless Chromium (issue 338). Skipped when chromium is not installed.
# From the repo root: device/edge/tests/dashboard-charts.sh
set -u
node "$(dirname "$0")/dashboard-charts.js"
rc=$?
[ "$rc" = 77 ] && exit 0
exit "$rc"
