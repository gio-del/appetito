#!/bin/sh
# Test of is_newer / report / cand in update-apps (issue 416): an update is only a strictly newer version.
# Run from the repo root: device/edge/tests/update-apps-newer.sh
set -eu
UA=$PWD/device/edge/debian/update-apps
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
# the three helper functions, cut from the script (single-line or tab-continued definitions)
awk '/^is_newer\(\)/,/sort -V/ {print} /^cand\(\)/,/HS_UPDATES_OUT"; }$/ {print} /^report\(\)/ {print}' "$UA" > "$t/fn.sh"
. "$t/fn.sh"
fail() { echo "FAIL: update-apps-newer: $*"; exit 1; }
yes_() { is_newer "$1" "$2" || fail "$1 -> $2 should be an update"; }
no_() { ! is_newer "$1" "$2" || fail "$1 -> $2 must not be an update"; }
no_ 0.107.79 0.107.79                 # equal
no_ v0.108.0-b.16 v0.107.79           # newer (beta) than latest stable: no downgrade
no_ 0.108.0 0.107.79                  # newer
no_ v22.5.0 v22.4.9                   # older upstream
yes_ 0.107.79 0.107.80                # normal update
yes_ v0.107.79 v0.108.0-b.16          # forward to a pre-release
yes_ 0.108.0-b.16 0.108.0             # pre-release -> its final
no_ 0.108.0 0.108.0-b.16              # final -> pre-release
yes_ v22.4.9 v22.10.0                 # numeric, not lexical
yes_ "" 1.0.0                         # unknown current: any difference
# report and cand
out=$(report adguardhome v0.108.0-b.16 v0.107.79)
case $out in "ok "*"più nuova"*) ;; *) fail "report: $out";; esac
case $(report adguardhome v0.107.79 v0.107.80) in UPDATE*) ;; *) fail "report update";; esac
HS_UPDATES_OUT=$t/out; : > "$t/out"
cand adguardhome v0.108.0-b.16 v0.107.79 "" how
[ ! -s "$t/out" ] || fail "cand wrote a downgrade"
cand adguardhome v0.107.79 v0.107.80 "" how
[ "$(wc -l < "$t/out")" = 1 ] || fail "cand missed an update"
cand vaultwarden 1.0 sha256:x "" how sha256:x   # digest with ref: always reported
[ "$(wc -l < "$t/out")" = 2 ] || fail "cand with ref"
echo "ok: update-apps-newer"
