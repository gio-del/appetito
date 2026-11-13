#!/bin/sh
# Test of the tracker's /api/queue-config (issue 225): owner session, validation (strategy, weights 1-5, only
# listed sources, focus needs a project), preview does not save, saved config is what ops-auto reads.
# From the repo root: device/edge/tests/tracker-queue-config.sh
set -eu
exec node "$(dirname "$0")/tracker-queue-config.js"
