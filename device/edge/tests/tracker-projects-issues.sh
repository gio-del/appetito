#!/bin/sh
# Test of the tracker's /api/projects-issues (issue 091): ids "<project>#<n>", trust flags, only
# github.com links, odd project names dropped. From the repo root: device/edge/tests/tracker-projects-issues.sh
set -eu
exec node "$(dirname "$0")/tracker-projects-issues.js"
