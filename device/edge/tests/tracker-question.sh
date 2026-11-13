#!/bin/sh
# Test of the second brain questions answered in the tracker (issue 294).
# From the repo root: device/edge/tests/tracker-question.sh
set -eu
exec node "$(dirname "$0")/tracker-question.js"
