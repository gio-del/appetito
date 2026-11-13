#!/bin/sh
# Test of attriti-card (issue 468): weekly measure of the requests to the owner, history, trend. Offline.
# From the repo root: device/edge/tests/attriti-card.sh
set -eu
R=$(cd "$(dirname "$0")/../../.." && pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail=0
check() { [ "$2" = "$3" ] || { echo "FAIL: $1: got '$2', want '$3'" >&2; fail=1; }; }
cat > "$t/sig" <<'EOF2'
#!/bin/sh
cat "$FAKE_DIR/sig.json"
EOF2
chmod +x "$t/sig"
run() { HOME=$t HS_ATTRITI_SIGNALS="$t/sig" HS_ATTRITI_CARD="$t/card.json" HS_ATTRITI_HISTORY="$t/hist.json" HS_ATTRITI_NOW=$1 FAKE_DIR=$t node "$R/device/edge/debian/attriti-card"; }
echo '{"counts":{"hitlUnanswered":5,"blockedUser":4},"hitl":[{"answered":false,"waitedDays":9},{"answered":true,"waitedDays":30}],"blockedUser":[{"days":12}],"failedRuns":[{},{}]}' > "$t/sig.json"
run 2026-11-02
check "hitl" "$(jq .hitlWaiting "$t/card.json")" 5
check "max wait" "$(jq .maxWaitDays "$t/card.json")" 12
check "rounds" "$(jq .roundsToOwner "$t/card.json")" 2
check "week monday" "$(jq -r .week "$t/card.json")" 2026-11-02
check "no trend first week" "$(jq -r .trend "$t/card.json")" ""
echo '{"counts":{"hitlUnanswered":2,"blockedUser":3},"hitl":[],"blockedUser":[],"failedRuns":[]}' > "$t/sig.json"
run 2026-11-04; check "same week replaced" "$(jq 'keys | length' "$t/hist.json")" 1
echo '{"counts":{"hitlUnanswered":1,"blockedUser":3},"hitl":[],"blockedUser":[],"failedRuns":[]}' > "$t/sig.json"
run 2026-11-10
check "week 2" "$(jq -r .week "$t/card.json")" 2026-11-09
check "trend down" "$(jq -r .trend "$t/card.json")" "in calo"
check "previous" "$(jq .previous.hitlWaiting "$t/card.json")" 2
echo '{"counts":{"hitlUnanswered":2,"blockedUser":1}}' > "$t/sig.json"; run 2026-11-10
check "mail line" "$(jq -r .mail "$t/card.json" | grep -c '^Attriti: 2 domande senza risposta')" 1
[ "$fail" = 0 ] && echo "attriti-card: ok"
exit "$fail"
