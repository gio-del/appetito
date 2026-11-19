#!/bin/sh
# Test of ops-auto cut off by the 5-hour limit (issue 108) and of its exit codes (issue 574): the limit is written and the attempt
# not counted, the next round waits for the reset; a timeout exits 0, a real error 1. (Resuming the work: ops-auto-worktree.sh, issue 636.)
# Runs ops-auto with a stub claude in a temp HOME/repo. From the repo root: device/edge/tests/ops-auto-resume.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
H=$t/home
mkdir -p "$H/bin" "$H/.local/bin" "$H/home-server/issues/open" "$H/home-server/issues/done"
cp "$R/device/edge/debian/ai-run" "$R/device/edge/debian/ops-auto" "$R/device/edge/debian/ops-auto-request" "$H/bin/"
printf '#!/bin/sh\n' > "$H/bin/ops-auto-card"
printf '#!/bin/sh\ncase $1 in HS_AUTO_QUOTA_MAX) echo 50 ;; HS_AUTO_PAUSE) echo 0 ;; HS_AUTO_MAX_PER_RUN) echo 1 ;; *) echo default ;; esac\n' > "$H/.local/bin/hs-setting"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/hs-runlog"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/issues-context"
printf '#!/bin/sh\necho "$*" >> "$HOME/hs-run.calls"\n' > "$H/.local/bin/hs-run"
# claude stub: records the prompt; mode "limit" edits a file and is cut off by the 5-hour limit.
cat > "$H/.local/bin/claude" <<'EOF'
#!/bin/sh
printf '%s\n' "$2" >> "$HOME/prompts"
if [ "$(cat "$HOME/mode")" = limit ]; then
	echo "{\"type\":\"rate_limit_event\",\"rate_limit_info\":{\"status\":\"rejected\",\"resetsAt\":$(cat "$HOME/reset")}}"
fi
echo '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"total_cost_usd":0.1}'
EOF
chmod +x "$H/bin/"* "$H/.local/bin/"*
issue() { printf '# %s\n\nOpened: 2026-10-15\nBlocked on: -\nStatus: todo\nPriority: %s\n\nbody\n' "$2" "$3" > "$H/home-server/issues/open/$1-x.md"; }
cd "$H/home-server"
git init -q -b main && git config user.name t && git config user.email t@t
echo base > src.txt; issue 200 "Issue A" high
git add -A && git commit -qm init
export HS_QUEUE_PROJECTS_JSON= HOME="$H" HS_AUTO_QUIET=-2000000000 HS_AUTO_REQUEST="$t/none.json" HS_AUTO_DETAIL="$t/detail.json" HS_ISSUES_JS="$R/device/edge/tracker/issues.js"
ST=$H/.local/state/ops-auto
run() { "$H/bin/ops-auto" "$@" > /dev/null 2>&1 || true; }
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
prompts() { grep -c . "$H/prompts" 2>/dev/null || echo 0; }

echo limit > "$H/mode"; echo $(($(date +%s) + 3600)) > "$H/reset"
run
check "cut off: limited written" "$(cat "$ST/limited")" "$(cat "$H/reset")"
check "cut off: attempt not counted" "$(cat "$ST/attempts/200")" 0
run
check "before the reset: waits" "$(grep -c 'fermo per il limite' "$ST/round")" 1
check "before the reset: claude not run" "$(prompts)" 1

# Timeout (rc 124, issue 574): exits 0; a real error (rc 1) still exits 1.
cat > "$H/.local/bin/claude" <<'EOF'
#!/bin/sh
echo '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"total_cost_usd":0.1}'
exit "$(cat "$HOME/mode")"
EOF
rm -f "$ST/limited"
echo 124 > "$H/mode"; rc=0; "$H/bin/ops-auto" > /dev/null 2>&1 || rc=$?
check "timeout: ops-auto exits 0" "$rc" 0
check "timeout: line in the log" "$(grep -c 'interrotto dal timeout' "$ST/ops-auto.log")" 1
echo 1 > "$H/mode"; rc=0; "$H/bin/ops-auto" > /dev/null 2>&1 || rc=$?
check "real error, first: retried, exits 0 (issue 637)" "$rc" 0
rc=0; "$H/bin/ops-auto" > /dev/null 2>&1 || rc=$?
check "real error, second in a row: exits 1" "$rc" 1

exit $fail
