#!/bin/sh
# Test of debian/owner-notify (issue 286) with a fake hs-notify: one push per event, no repeat, summary only when
# the set changed, nothing at zero events, daily cap. Run from the repo root: device/edge/tests/owner-notify.sh
set -eu
S=$PWD/device/edge/debian/owner-notify
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/sd" "$t/iss"
printf '#!/bin/sh\necho "$*" >> %s/got\n' "$t" > "$t/notify"; printf '#!/bin/sh\necho %s\n' '${FAKE_MAX:-4}' > "$t/set"; chmod +x "$t/notify" "$t/set"
fail() { echo "FAIL: owner-notify: $*"; cat "$t/got" 2>/dev/null; exit 1; }
run() { HOME=$t HS_NOTIFY=$t/notify HS_SETTING_CMD=$t/set HS_STATUS_DIR=$t/sd HS_ISSUES_DIR=$t/iss HS_OWNER_NOTIFY_STATE=$t/st HS_NOW=${NOW:-1793268000} sh "$S"; }
n() { [ -e "$t/got" ] && wc -l < "$t/got" || echo 0; }
echo '{"pending":"0 (sistema 0, second brain 0)"}' > "$t/sd/proposals.json"
echo '{"projects":{"a":{"status":"waiting"}}}' > "$t/sd/release-gate.json"
run; [ "$(n)" = 0 ] || fail "zero events must send nothing"
echo '{"pending":"2 (sistema 1, second brain 1)"}' > "$t/sd/proposals.json"
run; run; [ "$(n)" = 1 ] || fail "summary once"; grep -q "2 cose" "$t/got" || fail "summary text"
echo '{"projects":{"a":{"status":"serve-owner","version":"1.0.0"}}}' > "$t/sd/release-gate.json"
run; [ "$(n)" = 2 ] || fail "summary changed"; grep -q "3 cose" "$t/got" || fail "summary count"
printf 'Blocked on: user (x)\n\n- [ ] (HITL) scegli (perche)\n' > "$t/iss/050-x.md"
printf 'Blocked on: -\n\n- [ ] (HITL) no\n' > "$t/iss/051-y.md"
run; run; [ "$(n)" = 3 ] || fail "one hitl push, only for Blocked on: user"; grep -q -- "--urgent.*issue 50\|--urgent.*issue 050" "$t/got" || fail "hitl urgent"
echo '{"projects":{"a":{"status":"announced","version":"1.1.0"}}}' > "$t/sd/release-gate.json"
run; run; [ "$(n)" -ge 4 ] || fail "announced push"; grep -q "a 1.1.0" "$t/got" || fail "announced text"
echo '{"pending":"3 (sistema 1, second brain 2)","questions":1}' > "$t/sd/proposals.json"
rm -f "$t/got"; rm -f "$t/st/summary" "$t/st/count"; run; grep -q "domande del brain" "$t/got" || fail "question in summary"; grep -q "2 proposte" "$t/got" || fail "questions not counted as proposals"
# actions (issue 309): click on the thing, at most 3 view actions, https only
rm -rf "$t/st" "$t/got"; echo '{"projects":{"a":{"status":"announced","version":"1.1.0","url":"https://github.com/o/r/pull/9"}}}' > "$t/sd/release-gate.json"; run
grep -q "Rispondi=https://[^ /]*:8444/#050/rispondi" "$t/got" || fail "hitl Rispondi action"
grep -q "Changelog=https://github.com/o/r/pull/9" "$t/got" || fail "release Changelog action"
grep -q "Rimanda=https://[^ /]*:8444/projects.html" "$t/got" || fail "release Rimanda action"
grep -q "Tracker=https://[^ /]*:8444/" "$t/got" || fail "summary Tracker action"
while read -r l; do [ "$(printf "%s" "$l" | grep -o -- "--action" | wc -l)" -le 3 ] || fail "more than 3 actions"; done < "$t/got"
if grep -o "=http[^ ]*" "$t/got" | grep -qv "=https://"; then fail "non-https url"; fi
# cap
rm -rf "$t/st" "$t/got"; FAKE_MAX=1 run; [ "$(n)" = 1 ] || fail "cap of 1"
rm -rf "$t/st" "$t/got"; FAKE_MAX=0 run; [ "$(n)" = 0 ] || fail "cap 0 = off"
echo "ok   owner-notify"
