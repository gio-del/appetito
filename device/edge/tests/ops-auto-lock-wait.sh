#!/bin/sh
# A manual start ("Avvia ora") that meets a scheduled round holding the lock waits for it and then
# runs; if the holder is a manual round, or the wait runs out, the request is answered busy
# (issue 347). Temp HOME/repo. From the repo root: device/edge/tests/ops-auto-lock-wait.sh
set -eu
R=$(pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
H=$t/home
mkdir -p "$H/bin" "$H/.local/bin" "$H/home-server/issues/open" "$H/home-server/issues/done"
cp "$R/device/edge/debian/ops-auto" "$H/bin/"
printf '#!/bin/sh\n' > "$H/bin/ops-auto-card"
printf '#!/bin/sh\ncase $1 in HS_AUTO_QUOTA_MAX) echo 50 ;; HS_AUTO_PAUSE) echo 0 ;; *) echo default ;; esac\n' > "$H/.local/bin/hs-setting"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/hs-runlog"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/issues-context"
chmod +x "$H/bin/"* "$H/.local/bin/"*
cd "$H/home-server"; git init -q -b main && git config user.name t && git config user.email t@t
git add -A 2>/dev/null; git commit -qm init --allow-empty
export HS_QUEUE_PROJECTS_JSON= HOME="$H" HS_AUTO_REQUEST="$t/none.json" HS_AUTO_DETAIL="$t/detail.json" HS_ISSUES_JS="$R/device/edge/tracker/issues.js"
ST=$H/.local/state/ops-auto; mkdir -p "$ST"
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
hold() { ( exec 8>"$ST/lock"; flock 8; sleep "$1" ) & }
req() { echo '{"id":"0123456789abcdef","handled":1,"result":"started","reason":""}' > "$ST/request.json"; }

# 1. scheduled round holds the lock for 2 s: the manual start waits and runs
req; hold 2; sleep 0.5
HS_AUTO_LOCK_WAIT=10 "$H/bin/ops-auto" --manual > /dev/null 2>&1 || true; wait
check "waited: manual round started" "$(grep -c 'round start manual' "$ST/ops-auto.log")" 1
check "waited: still started" "$(jq -r .result "$ST/request.json")" started

# 2. holder is a manual round: busy at once
req; echo '{"manual":true}' > "$ST/current.json"; hold 3; sleep 0.5
HS_AUTO_LOCK_WAIT=10 "$H/bin/ops-auto" --manual > /dev/null 2>&1 || true
check "manual holder: busy" "$(jq -r .result "$ST/request.json")" busy
check "manual holder: reason" "$(jq -r .reason "$ST/request.json")" "un altro avvio manuale è in corso"
check "manual holder: no new round" "$(grep -c 'round start manual' "$ST/ops-auto.log")" 1
wait; rm -f "$ST/current.json"

# 3. the wait runs out
req; hold 4; sleep 0.5
HS_AUTO_LOCK_WAIT=1 "$H/bin/ops-auto" --manual > /dev/null 2>&1 || true
check "timeout: busy" "$(jq -r .result "$ST/request.json")" busy
check "timeout: logged" "$(grep -c 'refused (il giro in corso' "$ST/ops-auto.log")" 1
wait
exit $fail
