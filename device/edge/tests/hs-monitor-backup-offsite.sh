#!/bin/sh
# Test of hs-monitor's check on encrypted backups not reaching the PC (issue 083) with fake
# Syncthing API answers. Run from the repo root: device/edge/tests/hs-monitor-backup-offsite.sh
set -eu
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
C=PCPCPCP-BBB; M=EDGEEDG-CCC
D=86400000 NOW=2000000000000
api() { # $1 = PC completion %, $2 = PC connected, $3 = PC lastSeen (ISO)
	cat <<J
{ "system/status": {"myID": "$M"},
  "config/folders/vw-backup": {"devices": [{"deviceID": "$C"}, {"deviceID": "$M"}]},
  "config/devices": [{"deviceID": "$C", "name": "pc"}, {"deviceID": "$M", "name": "localhost"}],
  "system/connections": {"connections": {"$C": {"connected": $2}}},
  "stats/device": {"$C": {"lastSeen": "$3"}, "$M": {"lastSeen": "1970-01-01T01:00:00+01:00"}},
  "folder/errors?folder=vw-backup": {"errors": null, "folder": "vw-backup"},
  "db/completion?folder=vw-backup&device=$C": {"completion": $1, "needItems": $(( $1 < 100 ? 4 : 0 ))} }
J
}
iso() { node -e "console.log(new Date($1).toISOString())"; }
# Case 1, PC up to date (2 runs, 10 days apart); case 2, PC offline for 8 days (first run already);
# case 3, PC connected with the folder at 60%: nothing at first, an issue after 7 days, gone at 100%.
jq -n --argjson ok "$(api 100 true "$(iso $NOW)")" --argjson off "$(api 90 false "$(iso $((NOW - 8*D)))")" \
	--argjson part "$(api 60 true "$(iso $NOW)")" \
	"{days: 7, runs: [{now: $NOW, api: \$ok}, {now: $((NOW + 10*D)), api: \$ok},
	  {now: $NOW, api: \$off}, {now: $((NOW + 19*D)), api: \$ok},
	  {now: $((NOW + 20*D)), api: \$part}, {now: $((NOW + 26*D)), api: \$part}, {now: $((NOW + 27*D)), api: \$part}, {now: $((NOW + 28*D)), api: \$ok}]}" > "$t/fake.json"
device/edge/debian/hs-monitor --backup-offsite-test "$t/fake.json" > "$t/out"
cat > "$t/want" <<'W'
[]
[]
[{"fp":"backup-offsite","title":"I backup non arrivano al PC da 8 giorni"}]
[]
[]
[]
[{"fp":"backup-offsite","title":"I backup non arrivano al PC da 7 giorni"}]
[]
W
if diff -u "$t/want" "$t/out"; then echo "ok: hs-monitor backup offsite"; else echo "FAIL: hs-monitor backup offsite"; exit 1; fi
