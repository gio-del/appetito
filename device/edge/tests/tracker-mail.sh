#!/bin/sh
# Test of the tracker Mail page API (issue 015). From the repo root: device/edge/tests/tracker-mail.sh
set -eu
exec node "$(dirname "$0")/tracker-mail.js"
