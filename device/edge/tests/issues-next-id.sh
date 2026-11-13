#!/bin/sh
# Test of issue numbering (issue 087): `issues.js --next-id` counts open, done and proposed file names;
# `--lint` reports two files with the same number as `id-clash` (fingerprint lint-id-clash-NNN) and
# nothing without a clash. Temp repo only. From the repo root: device/edge/tests/issues-next-id.sh
set -eu
J=$(pwd)/device/edge/tracker/issues.js
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/issues/open" "$t/issues/done" "$t/issues/proposed"
mk() { printf '# Issue %s\n\nOpened: 2026-10-15\nBlocked on: -\nStatus: todo\n\nDistinct text %s.\n' "$2" "$2" > "$t/issues/$1/$2.md"; }
fail() { echo "FAIL: $*"; exit 1; }
[ "$(node "$J" --next-id "$t")" = 001 ] || fail "empty repo"
mk open 007-alpha; mk done 080-beta; mk proposed 082-gamma
[ "$(node "$J" --next-id "$t")" = 083 ] || fail "next id should count proposals"
node "$J" --lint "$t" | grep -q id-clash && fail "id-clash without a clash"
mk open 082-delta
[ "$(node "$J" --lint "$t" | jq -r '[.[] | select(.rule == "id-clash") | .fp] | join(" ")')" = lint-id-clash-082 ] || fail "clash not reported"
echo "ok: issues-next-id"
