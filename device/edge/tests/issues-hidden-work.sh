#!/bin/sh
# Test (issue 616): housekeep moves the non-HITL "- [ ]" steps of a `Blocked on: user` issue into a new
# todo issue blocked on it (with a comment), keeps the (HITL) step, leaves epics to the lint rule, and is
# idempotent; afterwards lint reports no hidden-work. Temp repo only.
set -eu
J=$(pwd)/device/edge/tracker/issues.js
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/issues/open" "$t/issues/done" "$t/issues/proposed"
fail() { echo "FAIL: $*"; exit 1; }
printf '# Issue uno\n\nOpened: 2026-11-16\nBlocked on: user (scelta)\nStatus: todo\n\nCosa alfa.\n\n## Esecuzione\n- [x] fatto\n- [ ] passo auto\n- [ ] (HITL) scegli (solo tu)\n' > "$t/issues/open/001-uno.md"
printf '# Epic due\n\nOpened: 2026-11-16\nBlocked on: user\nStatus: todo\nLabels: epic\n\nBeta.\n- [ ] lavoro\n' > "$t/issues/open/002-due.md"
[ "$(node "$J" --lint "$t" | jq -r '[.[] | select(.rule == "hidden-work")] | length')" = 2 ] || fail "lint should see hidden-work first"
node "$J" "$t" >/dev/null
c=$(ls "$t/issues/open" | grep -c '^003-') ; [ "$c" = 1 ] || fail "no child 003"
grep -q '^- \[ \] passo auto' "$t/issues/open/003-"*.md || fail "step not in child"
grep -q '^Blocked on: issue 001' "$t/issues/open/003-"*.md || fail "child not blocked on 001"
grep -q '^Status: todo' "$t/issues/open/003-"*.md || fail "child not todo"
! grep -q 'passo auto' "$t/issues/open/001-uno.md" || fail "step left in 001"
grep -q '(HITL) scegli' "$t/issues/open/001-uno.md" || fail "HITL step lost"
grep -q 'spostati nella issue 003' "$t/issues/open/001-uno.md" || fail "no comment"
grep -q 'lavoro' "$t/issues/open/002-due.md" || fail "epic touched"
[ "$(node "$J" --lint "$t" | jq -r '[.[] | select(.rule == "hidden-work")] | length')" = 1 ] || fail "only the epic should be left"
[ -z "$(node "$J" "$t")" ] || fail "not idempotent"
echo "ok: issues-hidden-work"
