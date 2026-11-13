#!/bin/sh
# Test of the tracker /api/apps (issue 477): session, only Project apps, validated actions, request file.
# From the repo root: device/edge/tests/tracker-apps.sh
set -eu
node "$(dirname "$0")/tracker-apps.js"
exec node "$(dirname "$0")/tracker-apps-ui.js"
