#!/bin/sh
# Functional test of the tasks/calendar web app in headless Chromium against a throwaway Radicale
# (issues 019, 178). Skipped when chromium or radicale is not installed.
# From the repo root: device/edge/tests/tasks-web-ui.sh [SHOTS_DIR]
set -u
node "$(dirname "$0")/tasks-web-ui.js" ${1:+"$1"}
rc=$?
[ "$rc" = 77 ] && exit 0
exit "$rc"
