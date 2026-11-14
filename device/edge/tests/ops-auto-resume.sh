#!/bin/sh
# Test of ops-auto resuming its own interrupted run (issue 108): a run cut off by the 5-hour limit
# leaves uncommitted work → `interrupted`; the round waits for the reset; ops-auto-request wakes it
# after the reset; the next round resumes that issue (even if another is first in the queue) with
# the "continue" prompt; one byte changed by someone else → "modifiche non committate"; handed over
# after 3 attempts → leftovers stashed, named in the issue, the next issue is worked.
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
	echo half-done >> "$HOME/home-server/src.txt"
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
check "cut off: interrupted written" "$(cut -d' ' -f1-2 "$ST/interrupted")" "200 limit"
check "cut off: limited written" "$(cat "$ST/limited")" "$(cat "$H/reset")"
check "cut off: attempt not counted" "$(cat "$ST/attempts/200")" 0
check "--interrupted" "$("$H/bin/ops-auto" --interrupted)" "200 limit"
check "--busy is not dirty" "$("$H/bin/ops-auto" --busy | grep -c dirty || true)" 0
run
check "before the reset: waits" "$(grep -c 'fermo per il limite' "$ST/round")" 1
check "before the reset: claude not run" "$(prompts)" 1

issue 201 "Issue B" urgent; git add -A issues && git commit -qm "issue 201"
echo $(($(date +%s) - 5)) > "$ST/limited"
"$H/bin/ops-auto-request"; sleep 1
check "wake after the reset" "$(cat "$H/hs-run.calls" 2>/dev/null)" "ops-auto $H/bin/ops-auto"
check "wake: limited removed" "$([ -e "$ST/limited" ] && echo yes || echo no)" no

echo noop > "$H/mode"
run
check "resume: same issue though 201 is first" "$(tail -1 "$H/prompts" | grep -c 'issues/open/200-x.md')" 1
check "resume: continue prompt" "$(tail -1 "$H/prompts" | grep -c 'Ripresa: il working tree contiene il lavoro non committato')" 1
check "resume: still interrupted" "$(cut -d' ' -f1-2 "$ST/interrupted")" "200 partial"

cp src.txt "$t/src.keep"; printf x >> src.txt
run
check "someone else's byte: not run" "$(prompts)" 2
check "someone else's byte: modifiche non committate" "$(grep -c 'rimandata #201: modifiche non committate' "$ST/round")" 1
cp "$t/src.keep" src.txt

echo 3 > "$ST/attempts/200"
run
check "handover: issue blocked on user" "$(grep -c '^Blocked on: user' issues/open/200-x.md)" 1
check "handover: stash with the issue number" "$(git stash list | grep -c 'ops-auto #200')" 1
check "handover: issue names the stash" "$(grep -c 'stash `ops-auto #200' issues/open/200-x.md)" 1
check "handover: tree clean" "$(git status --porcelain -- . ':!issues' | grep -c . || true)" 0
check "handover: next issue worked" "$(tail -1 "$H/prompts" | grep -c 'issues/open/201-x.md')" 1
check "handover: interrupted dropped" "$([ -e "$ST/interrupted" ] && echo yes || echo no)" no

# Timeout (rc 124, issue 574): exits 0; a real error (rc 1) still exits 1.
cat > "$H/.local/bin/claude" <<'EOF'
#!/bin/sh
echo '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"total_cost_usd":0.1}'
exit "$(cat "$HOME/mode")"
EOF
echo 124 > "$H/mode"; rc=0; "$H/bin/ops-auto" > /dev/null 2>&1 || rc=$?
check "timeout: ops-auto exits 0" "$rc" 0
check "timeout: line in the log" "$(grep -c 'interrotto dal timeout' "$ST/ops-auto.log")" 1
echo 1 > "$H/mode"; rc=0; "$H/bin/ops-auto" > /dev/null 2>&1 || rc=$?
check "real error: ops-auto exits 1" "$rc" 1

rm -f "$H/hs-run.calls"; echo $(($(date +%s) - 5)) > "$ST/limited"
"$H/bin/ops-auto-request"; sleep 1
check "no wake without interrupted" "$([ -e "$H/hs-run.calls" ] && echo yes || echo no)" no
exit $fail
