#!/bin/sh
# Layout test of the tracker board (issue 151): headless Chromium at phone and desktop widths, fails
# when the top bar or the filter bar overlap or overflow; screenshots in /tmp/tracker-ui/ (or $1).
# Run it before and after every UI change. Skipped when chromium is not installed.
# From the repo root: device/edge/tests/tracker-ui.sh [SHOTS_DIR]
set -u
node "$(dirname "$0")/tracker-ui.js" "${1:-/tmp/tracker-ui}"
rc=$?
[ "$rc" = 77 ] && exit 0
exit "$rc"
