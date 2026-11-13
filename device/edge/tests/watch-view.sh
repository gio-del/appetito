#!/bin/sh
# Test of the watch app's screens and cache logic (issue 292). From the repo root: device/edge/tests/watch-view.sh
set -eu
exec node "$(dirname "$0")/../../watch/test/view.test.js"
