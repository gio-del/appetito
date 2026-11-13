#!/bin/sh
# Test of the Owner-confirmed mark (issue 478): `issues-new --owner-confirmed` writes today's date, a plain
# new issue has none, `--lint` reports an invalid date (owner-confirmed-bad) and accepts a valid one.
# Temp repo only. From the repo root: device/edge/tests/issues-owner-confirmed.sh
set -eu
J=$(pwd)/device/edge/tracker/issues.js
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/issues/open" "$t/issues/done" "$t/issues/proposed"
fail() { echo "FAIL: $*"; exit 1; }
f=$(ISSUES_REPO="$t" node "$J" --new "Prima issue di prova" --owner-confirmed 2>/dev/null)
grep -q "^Owner-confirmed: $(date +%F)$" "$f" || fail "mark not written"
g=$(ISSUES_REPO="$t" node "$J" --new "Seconda cosa diversa" 2>/dev/null)
grep -q '^Owner-confirmed:' "$g" && fail "plain issue has the mark"
node "$J" --lint "$t" | grep -q owner-confirmed-bad && fail "valid date flagged"
sed -i 's/^Owner-confirmed: .*/Owner-confirmed: 2026-13-45/' "$f"
node "$J" --lint "$t" | grep -q owner-confirmed-bad || fail "invalid date not flagged"
echo "ok: issues-owner-confirmed"
