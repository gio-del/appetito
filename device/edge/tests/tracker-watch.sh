#!/bin/sh
# Test of the tracker's GET /api/watch (issue 290). From the repo root: device/edge/tests/tracker-watch.sh
set -eu
exec node "$(dirname "$0")/tracker-watch.js"
