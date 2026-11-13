#!/bin/sh
# Test of proposals for another Project (issue 161): /api/propose with `project`, the tag in the
# tracker, approval marks it Publish: pending, projects-publish-pending publishes it (issue 189), rejection allowed.
# From the repo root: device/edge/tests/tracker-propose-project.sh
set -eu
exec node "$(dirname "$0")/tracker-propose-project.js"
