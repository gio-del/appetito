#!/bin/sh
# Every active Project with an app (column 3 of device/edge/debian/projects) has its pause setting
# HS_CD_PAUSE_<NAME> in the tracker's schema: without it project-cd never installs its main (issue 496).
# From the repo root: device/edge/tests/project-cd-settings.sh
set -eu
R=$(cd "$(dirname "$0")/../../.." && pwd)
rc=0
grep -v '^ *#' "$R/device/edge/debian/projects" | while IFS='|' read -r name _ app status _; do
	name=$(echo "$name" | tr -d ' '); app=$(echo "$app" | tr -d ' '); status=$(echo "$status" | tr -d ' ')
	[ -n "$name" ] && [ -n "$app" ] && [ "$app" != - ] && [ "$status" = active ] || continue
	key=HS_CD_PAUSE_$(printf %s "$name" | tr a-z- A-Z_)
	jq -e --arg k "$key" 'has($k)' "$R/device/edge/tracker/settings.schema.json" > /dev/null || { echo "FAIL: $name ha un'app ma manca $key in settings.schema.json" >&2; exit 1; }
done || rc=1
[ $rc = 0 ] || exit 1
echo "ok: project-cd-settings"
