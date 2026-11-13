#!/bin/sh
# Test of hs-monitor's vault out-of-sync check (issue 070) with fake Syncthing API answers.
# Run from the repo root: device/edge/tests/hs-monitor-vault-sync.sh
set -eu
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
P=PIXEL00-AAA; C=PCPCPCP-BBB; M=EDGEEDG-CCC
api() { # $1 = pixel files (JSON array of names), $2 = pixel connected
	cat <<J
{ "system/status": {"myID": "$M"},
  "config/folders/vault": {"devices": [{"deviceID": "$P"}, {"deviceID": "$C"}, {"deviceID": "$M"}]},
  "config/devices": [{"deviceID": "$P", "name": "pixel"}, {"deviceID": "$C", "name": "pc"}, {"deviceID": "$M", "name": "localhost"}],
  "system/connections": {"connections": {"$P": {"connected": $2}, "$C": {"connected": false}}},
  "db/remoteneed?folder=vault&device=$P&perpage=1000": {"files": $(echo "$1" | jq -c 'map({name: .})'), "page": 1, "perpage": 1000},
  "db/remoteneed?folder=vault&device=$C&perpage=1000": {"files": [{"name": "never asked: offline"}], "page": 1, "perpage": 1000} }
J
}
two='["a: b.md", "c: d.md", ".obsidian/workspace.json"]'
H=3600000
jq -n --argjson a0 "$(api "$two" true)" --argjson a1 "$(api "$two" true)" --argjson a2 "$(api '["a: b.md", "e.md"]' true)" \
	--argjson a3 "$(api '["a: b.md"]' false)" --argjson a4 "$(api '["a: b.md"]' true)" --argjson a5 "$(api '[]' true)" \
	"{runs: [{now: 0, api: \$a0}, {now: $H, api: \$a1}, {now: $((2*H)), api: \$a2}, {now: $((3*H)), api: \$a3}, {now: $((3*H+60000)), api: \$a4}, {now: $((5*H)), api: \$a5}]}" > "$t/fake.json"
device/edge/debian/hs-monitor --vault-sync-test "$t/fake.json" > "$t/out"
cat > "$t/want" <<'W'
[]
[{"fp":"vault-sync-pixel00","title":"Il dispositivo «pixel» non riceve 2 file del vault"}]
[{"fp":"vault-sync-pixel00","title":"Il dispositivo «pixel» non riceve 1 file del vault"}]
[]
[]
[]
W
if diff -u "$t/want" "$t/out"; then echo "ok: hs-monitor vault sync"; else echo "FAIL: hs-monitor vault sync"; exit 1; fi
