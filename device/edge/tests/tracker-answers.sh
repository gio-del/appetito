#!/bin/sh
# Test of the tracker "Rispondi e sblocca" API (issue 173). From the repo root: device/edge/tests/tracker-answers.sh
set -eu
exec node "$(dirname "$0")/tracker-answers.js"
