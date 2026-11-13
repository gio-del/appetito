#!/bin/sh
# Test of the disk-full estimate (issue 357): debian/disk-eta on fake daily samples (steady growth within
# 10%, stable, shrinking, fewer than 3 days, only 2 samples, broken lines) and hs-monitor's 14-day rule.
# Run from the repo root: device/edge/tests/disk-eta.sh
set -eu
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
E=$PWD/device/edge/debian/disk-eta
GB=1000000000
fail() { echo "FAIL: disk-eta: $*"; exit 1; }
# series N START_GB PER_DAY_GB TOTAL_GB: N daily samples ending now
series() { node -e "
const [n, s, g, tot] = process.argv.slice(1).map(Number), now = 2000000000, GB = 1e9;
for (let i = n - 1; i >= 0; i--) console.log(JSON.stringify({ t: now - i * 86400, used: Math.round((s + g * (n - 1 - i)) * GB), total: tot * GB }));" "$@"; }
series 20 10 0.5 30 > "$t/grow"            # last 14 days: 0.5 GB/day, used 19.5, free 10.5 -> 21 days
series 20 10 0 30 > "$t/stable"
series 20 20 -0.3 30 > "$t/shrink"
series 2 10 1 30 > "$t/two"
series 3 10 1 30 > "$t/three"             # used 12 of 30, 1 GB/day -> 18 days
{ echo garbage; echo '{"a":1}'; series 5 10 1 30; } > "$t/broken"
: > "$t/empty"
out() { "$E" "$1"; }
d=$(out "$t/grow" | jq -r '.days'); [ "$d" -ge 19 ] && [ "$d" -le 23 ] || fail "grow: $d days instead of ~21"
[ "$(out "$t/stable" | jq -r .state)" = stable ] || fail "stable"
[ "$(out "$t/shrink" | jq -r .state)" = stable ] || fail "shrink"
[ "$(out "$t/two" | jq -r .state)" = none ] || fail "two samples"
[ "$(out "$t/empty" | jq -r .state)" = none ] || fail "empty"
[ "$(out "$t/nonexistent" | jq -r .state)" = none ] || fail "missing file"
d=$(out "$t/three" | jq -r '.days'); [ "$d" -ge 16 ] && [ "$d" -le 20 ] || fail "three: $d days instead of ~18"
d=$(out "$t/broken" | jq -r '.days'); [ "$d" -ge 14 ] && [ "$d" -le 18 ] || fail "broken: $d days"
# hs-monitor: finding only for state days < 14
echo '[{"state":"days","days":13,"per_day":2000000000},{"state":"days","days":14},{"state":"days","days":40},{"state":"stable"},{"state":"none"},null]' > "$t/eta.json"
device/edge/debian/hs-monitor --disk-eta-test "$t/eta.json" > "$t/out"
printf '["disk-eta"]\n[]\n[]\n[]\n[]\n[]\n' > "$t/want"
diff -u "$t/want" "$t/out" || fail "hs-monitor rule"
echo "ok: disk-eta"
