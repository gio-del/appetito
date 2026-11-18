#!/bin/sh
# Test of hs-monitor's recurrence comments on an open issue (issue 624): a fault that comes back every
# hour for 48 hours gives at most 2 comments when the issue is `Blocked on: user` (with its duration),
# 48 when it is not. Run from the repo root: device/edge/tests/hs-monitor-recurrence.sh
set -eu
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
NOW=2000000000000   # 2033-05-18 03:33 UTC
run() { jq -n --arg h "$1" "{head: \$h, from: $NOW, hours: 48}" > "$t/f.json"; TZ=UTC device/edge/debian/hs-monitor --recurrence-test "$t/f.json"; }
run "$(printf '# X\n\nOpened: 2033-05-17\nBlocked on: user (tailscale)\nStatus: todo')" > "$t/user"
run "$(printf '# X\n\nOpened: 2033-05-17\nBlocked on: -\nStatus: todo')" > "$t/free"
cat > "$t/want" <<'W'
Successo di nuovo (T). Dura da circa 27 ore. Il guasto aspetta l'owner: un solo commento al giorno.
Successo di nuovo (T). Dura da 2 giorni. Il guasto aspetta l'owner: un solo commento al giorno.
W
fail=0
diff -u "$t/want" "$t/user" || fail=1
[ "$(wc -l < "$t/free")" -eq 48 ] || { echo "free: want 48 comments, got $(wc -l < "$t/free")"; fail=1; }
grep -qx 'Successo di nuovo (T).' "$t/free" || { echo "free: text changed"; fail=1; }
[ $fail = 0 ] && echo "ok: hs-monitor recurrence" || { echo "FAIL: hs-monitor recurrence"; exit 1; }
