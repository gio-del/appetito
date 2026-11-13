#!/bin/sh
# Test of the hook ops-auto-guard (issue 451). From the repo root: device/edge/tests/ops-auto-guard.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
unset HS_OPS_AUTO # the test also runs inside ops-auto, where the hook is silent on purpose
export HS_OPS_AUTO_WORKING=$t/working
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
g() { printf '{"tool_input":{"file_path":"%s"}}' "$1" | sh "$R/device/edge/debian/ops-auto-guard" | jq -r '.hookSpecificOutput.permissionDecision // "none"' | grep . || echo none; }
check "no state file: silent" "$(g /h/home-server/a.sh)" none
sleep 300 & p=$!
echo "447 $(($(date +%s) - 600)) $p" > "$t/working"
check "working: file outside issues asks" "$(g /h/home-server/a.sh)" ask
check "message names issue and minutes" "$(printf '{"tool_input":{"file_path":"/x/a"}}' | sh "$R/device/edge/debian/ops-auto-guard" | jq -r '.hookSpecificOutput.permissionDecisionReason' | grep -c '#447 .* 10 minuti')" 1
check "inside issues/: silent" "$(g /h/home-server/issues/open/1-x.md)" none
check "inside ops-auto: silent" "$(HS_OPS_AUTO=1 g /h/home-server/a.sh)" none
kill $p; wait $p 2>/dev/null || true
check "run gone (dead pid): silent" "$(g /h/home-server/a.sh)" none
check "prompt: edit with Edit/Write rule (issue 523)" "$(grep -c 'Edit/Write tools, never `perl -pi`, `sed -i`' "$R/device/edge/debian/ops-auto-prompt.md")" 1
exit $fail
