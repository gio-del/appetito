#!/bin/sh
# Test of scripts/appetito-selfcheck (issue 568): green when the built copy passes its own check, red when the
# copy does not build, lacks the entry script, or the check fails (the failing lines are shown).
# From the repo root: device/edge/tests/appetito-selfcheck.sh
set -eu
S=$(pwd)/scripts/appetito-selfcheck
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
export HS_APPETITO_SELFCHECK_STAMP="$t/stamp"
fail() { echo "FAIL: $*"; exit 1; }
printf '#!/bin/sh\nmkdir -p "$1/device/edge"\nprintf "echo all good\\n" > "$1/device/edge/check"\n' > "$t/build-ok"
printf '#!/bin/sh\nmkdir -p "$1/device/edge"\nprintf "echo tests/x.sh FAIL: DIREZIONE.md manca >&2; exit 1\\n" > "$1/device/edge/check"\n' > "$t/build-red"
printf '#!/bin/sh\nmkdir -p "$1"\n' > "$t/build-empty"
printf '#!/bin/sh\nexit 1\n' > "$t/build-broken"
out=$(HS_APPETITO_BUILD_CMD="sh $t/build-ok" sh "$S" 2>&1) || fail "green copy refused: $out"
case $out in *"selfcheck: ok"*) ;; *) fail "no ok line: $out" ;; esac
out=$(HS_APPETITO_BUILD_CMD="sh $t/build-red" sh "$S" 2>&1) && fail "red copy passed"
case $out in *"DIREZIONE.md manca"*"non passa da sola"*) ;; *) fail "failure not shown: $out" ;; esac
out=$(HS_APPETITO_BUILD_CMD="sh $t/build-empty" sh "$S" 2>&1) && fail "copy without entry passed"
case $out in *"non contiene"*) ;; *) fail "no entry message: $out" ;; esac
out=$(HS_APPETITO_BUILD_CMD="sh $t/build-broken" sh "$S" 2>&1) && fail "broken build passed"
case $out in *"non si costruisce"*) ;; *) fail "no build message: $out" ;; esac
# Same green copy twice: the second run reads the stamp (issue 578); a changed copy runs again.
out=$(HS_APPETITO_BUILD_CMD="sh $t/build-ok" sh "$S" 2>&1) || fail "second run refused: $out"
case $out in *"gia' verificata"*) ;; *) fail "stamp not used: $out" ;; esac
printf '#!/bin/sh\nmkdir -p "$1/device/edge"\nprintf "echo changed\\n" > "$1/device/edge/check"\n' > "$t/build-ok2"
out=$(HS_APPETITO_BUILD_CMD="sh $t/build-ok2" sh "$S" 2>&1) || fail "changed copy refused: $out"
case $out in *"gia' verificata"*) fail "stamp used for a different copy" ;; esac
echo "ok"
