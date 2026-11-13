#!/bin/sh
# Test of hs-monitor's battery rules (issue 338) with fake history samples: hot for 30 minutes
# (>= threshold) and 100% while charging for too long open a finding, below the threshold or with
# a short/stale history they don't. Run from the repo root: device/edge/tests/hs-monitor-thermal.sh
set -eu
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
NOW=2000000000000
# rows N STEP_MIN BAT STATUS BT: N samples ending now, one every STEP_MIN minutes
rows() { node -e "
const [n, step, bat, st, bt] = process.argv.slice(1), now = $NOW / 1000, a = [];
for (let i = n - 1; i >= 0; i--) a.push({ t: now - i * step * 60, bat: +bat, st, bt: +bt, ct: 40, cpu: 5, ram: 40, disk: 10 });
console.log(JSON.stringify(a))" "$@"; }
hot41=$(rows 12 5 80 "In scarica" 41); hot39=$(rows 12 5 80 "In scarica" 39); short=$(rows 3 5 80 "In scarica" 45)
full=$(rows 600 5 100 "In carica" 33); fullshort=$(rows 100 5 100 "In carica" 33); unplugged=$(rows 600 5 100 "In scarica" 33)
stale=$(node -e "console.log(JSON.stringify($hot41.map(r => ({...r, t: r.t - 7200}))))")
jq -n --argjson h41 "$hot41" --argjson h39 "$hot39" --argjson sh "$short" --argjson f "$full" --argjson fs "$fullshort" \
	--argjson un "$unplugged" --argjson st "$stale" \
	"{hot: 40, full: 48, runs: [{now: $NOW, rows: \$h41}, {now: $NOW, rows: \$h39}, {now: $NOW, rows: \$sh}, {now: $NOW, rows: []},
	  {now: $NOW, rows: \$f}, {now: $NOW, rows: \$fs}, {now: $NOW, rows: \$un}, {now: $NOW, rows: \$st}, {now: $NOW, rows: \$h41}]}" > "$t/fake.json"
device/edge/debian/hs-monitor --thermal-test "$t/fake.json" > "$t/out"
cat > "$t/want" <<'W'
["battery-hot"]
[]
[]
[]
["battery-full"]
[]
[]
[]
["battery-hot"]
W
if diff -u "$t/want" "$t/out"; then echo "ok: hs-monitor thermal"; else echo "FAIL: hs-monitor thermal"; exit 1; fi
