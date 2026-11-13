#!/bin/sh
# Test of hs-monitor's check on vault devices not connecting to Syncthing (issue 148) with fake
# API answers. Run from the repo root: device/edge/tests/hs-monitor-vault-offline.sh
set -eu
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
P=PIXEL00-AAA; M=EDGEEDG-CCC
H=3600000 NOW=2000000000000
api() { # $1 = pixel connected, $2 = pixel lastSeen (ISO)
	cat <<J
{ "system/status": {"myID": "$M"},
  "config/folders/vault": {"devices": [{"deviceID": "$P"}, {"deviceID": "$M"}]},
  "config/devices": [{"deviceID": "$P", "name": "pixel"}, {"deviceID": "$M", "name": "localhost"}],
  "system/connections": {"connections": {"$P": {"connected": $1}}},
  "stats/device": {"$P": {"lastSeen": "$2"}, "$M": {"lastSeen": "1970-01-01T01:00:00+01:00"}} }
J
}
iso() { node -e "console.log(new Date($1).toISOString())"; }
never=1970-01-01T01:00:00+01:00
# connected; seen 10 h ago (under 24 h); seen 30 h ago; back online; never seen (first run, +23 h, +25 h).
jq -n --argjson ok "$(api true "$(iso $NOW)")" --argjson s10 "$(api false "$(iso $((NOW - 10*H)))")" \
	--argjson s30 "$(api false "$(iso $((NOW - 30*H)))")" --argjson nv "$(api false "$never")" \
	"{hours: 24, runs: [{now: $NOW, api: \$ok}, {now: $NOW, api: \$s10}, {now: $NOW, api: \$s30}, {now: $NOW, api: \$ok},
	  {now: $NOW, api: \$nv}, {now: $((NOW + 23*H)), api: \$nv}, {now: $((NOW + 25*H)), api: \$nv}, {now: $((NOW + 26*H)), api: \$ok}]}" > "$t/fake.json"
device/edge/debian/hs-monitor --vault-offline-test "$t/fake.json" > "$t/out"
cat > "$t/want" <<'W'
[]
[]
[{"fp":"vault-offline-pixel00","title":"Il dispositivo «pixel» non si collega a Syncthing"}]
[]
[]
[]
[{"fp":"vault-offline-pixel00","title":"Il dispositivo «pixel» non si collega a Syncthing"}]
[]
W
if diff -u "$t/want" "$t/out"; then echo "ok: hs-monitor vault offline"; else echo "FAIL: hs-monitor vault offline"; exit 1; fi
