#!/bin/sh
# Test of ai-delegate (issue 252) with fake worker and validator: accepted output is printed, rejected or
# empty worker output falls back to the big model, FALLBACK=0 prints nothing (rc 3).
# From the repo root: device/edge/tests/ai-delegate.sh
set -eu
A=$(pwd)/device/edge/debian/ai-delegate
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
res() { printf '{"type":"result","result":"%s"}\n' "$1"; }
cat > "$t/worker" <<'W'
#!/bin/sh
case ${FAKE_WORKER:-good} in good) echo '{"type":"result","result":"bozza locale"}' ;; empty) exit 1 ;; esac
W
cat > "$t/big" <<'B'
#!/bin/sh
# validator prompts contain "validatore"; any other prompt is the task done by the big model
case "$2" in *validatore*) echo "{\"type\":\"result\",\"result\":\"${FAKE_VERDICT:-ACCEPT}\"}" ;; *) echo '{"type":"result","result":"versione grande"}' ;; esac
B
chmod +x "$t/worker" "$t/big"
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
run() { HS_DELEGATE_WORKER=$t/worker HS_DELEGATE_BIG=$t/big sh "$A" "$@" 2>"$t/err" || echo "rc=$?"; }
check "accepted" "$(run "task")" "bozza locale"
check "accepted log" "$(cat "$t/err")" "ai-delegate: accepted"
check "accepted with punctuation" "$(FAKE_VERDICT=' accept. ' run "task")" "bozza locale"
check "rejected -> big model" "$(FAKE_VERDICT=REJECT run "task")" "versione grande"
check "rejected log" "$(tail -1 "$t/err")" "ai-delegate: fallback"
check "unclear verdict -> big model" "$(FAKE_VERDICT='non so' run "task")" "versione grande"
check "worker fails -> big model" "$(FAKE_WORKER=empty run "task")" "versione grande"
check "rejected, no fallback" "$(FALLBACK=0 FAKE_VERDICT=REJECT run "task")" "rc=3"
printf 'nota' > "$t/in"
check "input file" "$(run "task" "$t/in")" "bozza locale"
exit $fail
