#!/bin/sh
# Test of the manual start's own quota limit (issue 175): over HS_AUTO_QUOTA_MAX a scheduled round
# stops, a --manual one runs up to HS_AUTO_QUOTA_MANUAL_MAX; over that one it stops too; a manual
# limit lower than the scheduled one (or unset) changes nothing.
# Runs ops-auto with a stub claude in a temp HOME/repo. From the repo root: device/edge/tests/ops-auto-manual-quota.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
H=$t/home
mkdir -p "$H/bin" "$H/.local/bin" "$H/home-server/issues/open" "$H/home-server/issues/done"
cp "$R/device/edge/debian/ai-run" "$R/device/edge/debian/ops-auto" "$H/bin/"
printf '#!/bin/sh\n' > "$H/bin/ops-auto-card"
cat > "$H/.local/bin/hs-setting" <<'S'
#!/bin/sh
case $1 in HS_AUTO_QUOTA_MAX) echo 50 ;; HS_AUTO_QUOTA_MANUAL_MAX) cat "$HOME/manual-max" ;; HS_AUTO_PAUSE) echo 0 ;; HS_AUTO_MAX_PER_RUN) echo 1 ;; *) echo default ;; esac
S
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/hs-runlog"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/issues-context"
cat > "$H/.local/bin/claude" <<'EOF2'
#!/bin/sh
echo run >> "$HOME/runs"
echo '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"total_cost_usd":0.1}'
EOF2
chmod +x "$H/bin/"* "$H/.local/bin/"*
cd "$H/home-server"
git init -q -b main && git config user.name t && git config user.email t@t
printf '# Issue A\n\nOpened: 2026-10-15\nBlocked on: -\nStatus: todo\n\nbody\n' > issues/open/200-x.md
git add -A && git commit -qm init
export HS_QUEUE_PROJECTS_JSON= HOME="$H" HS_AUTO_QUIET=-2000000000 HS_AUTO_REQUEST="$t/none.json" HS_AUTO_DETAIL="$t/detail.json" HS_ISSUES_JS="$R/device/edge/tracker/issues.js"
ST=$H/.local/state/ops-auto
mkdir -p "$ST"
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
runs() { grep -c . "$H/runs" 2>/dev/null || echo 0; }
usage() { echo "$1 $(($(date +%s) + 3600))" > "$ST/usage"; }
round() { rm -f "$H/runs"; "$H/bin/ops-auto" "$@" > /dev/null 2>&1 || true; runs; }

echo 80 > "$H/manual-max"; usage 53
check "53%, scheduled: stops" "$(round)" 0
check "53%, scheduled: logged" "$(tail -1 "$ST/round" | grep -c 'fermo per la quota')" 1
check "53%, manual (max 80): runs" "$(round --manual --issue 200)" 1
usage 85
check "85%, manual (max 80): stops" "$(round --manual --issue 200)" 0
echo 30 > "$H/manual-max"; usage 40
check "40%, manual max 30 < scheduled 50: runs" "$(round --manual --issue 200)" 1
usage 53
check "53%, manual max 30 < scheduled 50: stops" "$(round --manual --issue 200)" 0
echo default > "$H/manual-max"
check "53%, manual max unset: stops" "$(round --manual --issue 200)" 0
exit $fail
