#!/bin/sh
# Test of the Owner-confirmed mark in the tracker (issue 478).
# From the repo root: device/edge/tests/tracker-owner-confirmed.sh
set -eu
exec node "$(dirname "$0")/tracker-owner-confirmed.js"
