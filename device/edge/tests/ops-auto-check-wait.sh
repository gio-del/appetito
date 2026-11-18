#!/bin/sh
# ops-auto skips a local issue whose `Check:` is false (issue 628): claude is not started, the log says so once a day;
# with the check true (or found.json stale) the issue is picked. Temp HOME/repo. From the repo root: device/edge/tests/ops-auto-check-wait.sh
set -eu
R=$(pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
H=$t/home
mkdir -p "$H/bin" "$H/.local/bin" "$H/home-server/issues/open" "$H/home-server/issues/done" "$t/qs"
cp "$R/device/edge/debian/ai-run" "$R/device/edge/debian/ops-auto" "$R/device/edge/debian/ops-auto-request" "$H/bin/"
printf '#!/bin/sh\n' > "$H/bin/ops-auto-card"
printf '#!/bin/sh\ncase $1 in HS_AUTO_QUOTA_MAX) echo 50 ;; HS_AUTO_PAUSE) echo 0 ;; HS_AUTO_MAX_PER_RUN) echo 1 ;; *) echo default ;; esac\n' > "$H/.local/bin/hs-setting"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/hs-runlog"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/issues-context"
printf '#!/bin/sh\n' > "$H/.local/bin/hs-run"
cat > "$H/.local/bin/claude" <<'EOS'
#!/bin/sh
echo run >> "$HOME/claude-runs"
echo '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"total_cost_usd":0.1}'
EOS
chmod +x "$H/bin/"* "$H/.local/bin/"*
printf '# Attesa\n\nOpened: 2026-11-01\nBlocked on: -\nStatus: todo\nCheck: url-contains https://raw.example/f 1.27.4\n\nbody\n' > "$H/home-server/issues/open/020-attesa.md"
cd "$H/home-server"; git init -q -b main && git config user.name t && git config user.email t@t
git add -A && git commit -qm init
export HS_QUEUE_PROJECTS_JSON= HOME="$H" HS_AUTO_QUIET=-2000000000 HS_AUTO_REQUEST="$t/none.json" HS_AUTO_DETAIL="$t/detail.json" HS_ISSUES_JS="$R/device/edge/tracker/issues.js" QS_DIR="$t/qs"
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
found() { printf '{"020":{"ok":%s,"check":"x","evidence":"non contiene ancora 1.27.4","at":%s}}\n' "$1" "$2" > "$t/qs/found.json"; }
found false "$(date +%s)"
"$H/bin/ops-auto" > /dev/null 2>&1 || true
"$H/bin/ops-auto" > /dev/null 2>&1 || true
check "false check: claude not started" "$(cat "$H/claude-runs" 2>/dev/null | wc -l | tr -d ' ')" 0
check "false check: logged once" "$(grep -c '#020 saltata' "$H/.local/state/ops-auto/ops-auto.log")" 1
found true "$(date +%s)"
"$H/bin/ops-auto" > /dev/null 2>&1 || true
check "true check: claude started" "$(wc -l < "$H/claude-runs" 2>/dev/null | tr -d ' ' || echo 0)" 1
exit $fail
