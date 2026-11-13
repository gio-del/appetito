#!/bin/sh
# Test of the mechanical shape fixes (issue 114): housekeep adds a missing Status (todo with steps, backlog
# without), canonicalises a known spelling, drops nonexistent Blocked on ids and a nonexistent Parent, each
# with a "(sistema)" comment; lint marks those findings auto (hs-monitor opens no issue) and keeps the
# judgement ones (unknown Status word, two-level Parent) manual; issues-new writes a full header.
# Temp repo only. From the repo root: device/edge/tests/issues-autofix.sh
set -eu
J=$(pwd)/device/edge/tracker/issues.js
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/issues/open" "$t/issues/done" "$t/issues/proposed"
fail() { echo "FAIL: $*"; exit 1; }
w() { printf '# Issue %s\n\nOpened: 2026-10-15\n%b\nDistinct words %s.\n%s\n' "$1" "$2" "$1" "${3:-}" > "$t/issues/open/$1.md"; }
f() { grep -q "^$2$" "$t/issues/open/$1.md" || fail "$1: no line «$2»"; }
nf() { ! grep -q "^$2" "$t/issues/open/$1.md" || fail "$1: still «$2»"; }
w 001-a 'Blocked on: -\n' '- [ ] do it'
w 002-b 'Blocked on: -\n'
w 003-c 'Blocked on: -\nStatus: In progress\n'
w 004-d 'Blocked on: issue 001, 099\nStatus: todo\n'
w 005-e 'Blocked on: issue 098\nStatus: todo\nParent: 097\n'
w 006-f 'Blocked on: -\nStatus: someday\n'
w 007-g 'Blocked on: -\nStatus: todo\nParent: 008\n'
w 008-h 'Blocked on: -\nStatus: todo\nParent: 001\n'
lint() { node "$J" --lint "$t" | jq -r "[.[] | select(.auto == $1 and .rule != \"possible-duplicate\" and .rule != \"related-auto\") | .fp] | sort | join(\" \")"; }
[ "$(lint true)" = "lint-blocker-missing-004 lint-blocker-missing-005 lint-no-status-001 lint-no-status-002 lint-no-status-003 lint-parent-bad-005" ] || fail "auto findings: $(lint true)"
[ "$(lint false)" = "lint-no-status-006 lint-parent-bad-007" ] || fail "manual findings: $(lint false)"
node "$J" "$t" >/dev/null
f 001-a 'Status: todo'; f 002-b 'Status: backlog'; f 003-c 'Status: in-progress'
f 004-d 'Blocked on: issue 001'; f 005-e 'Blocked on: -'; nf 005-e 'Parent:'
f 006-f 'Status: someday'; f 007-g 'Parent: 008'
grep -q '^### .* (sistema)$' "$t/issues/open/005-e.md" || fail "no (sistema) comment"
grep -q 'Parent «097» tolto' "$t/issues/open/005-e.md" || fail "comment does not say what changed"
[ "$(lint true)" = "" ] || fail "auto findings left: $(lint true)"
[ -z "$(node "$J" "$t")" ] || fail "housekeep not idempotent"
out=$(ISSUES_REPO=$t node "$J" --new 'Nuova cosa' --parent 001 --labels 'Ops, x' --related 008 2>/dev/null)
[ "$out" = "$t/issues/open/009-nuova-cosa.md" ] || fail "issues-new path: $out"
f 009-nuova-cosa 'Status: todo'; f 009-nuova-cosa 'Blocked on: -'; f 009-nuova-cosa 'Parent: 001'; f 009-nuova-cosa 'Labels: ops, x'
ISSUES_REPO=$t node "$J" --new 'Altra' --status maybe 2>/dev/null && fail "issues-new took a bad Status"
ISSUES_REPO=$t node "$J" --new 'Altra' --parent 077 2>/dev/null && fail "issues-new took a missing Parent"
[ "$(node "$J" --lint "$t" | jq -r '[.[] | select(.id == "009")] | length')" = 0 ] || fail "issues-new file fails lint"
echo "ok: issues-autofix"
