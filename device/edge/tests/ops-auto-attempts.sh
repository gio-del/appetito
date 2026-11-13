#!/bin/sh
# Test of the ops-auto attempt counter (issue 147): a run ending "in corso" with a commit of its
# own ("NNN …") that changes a file outside issues/ resets the attempts (log "avanzamento");
# runs without one (no commit, or only "issues: update") hand the issue over at the 4th run;
# past HS_AUTO_MAX_RUNS total runs it goes to the owner as "troppi giri".
# Runs ops-auto with a stub claude in a temp HOME/repo. From the repo root: device/edge/tests/ops-auto-attempts.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
H=$t/home
mkdir -p "$H/bin" "$H/.local/bin" "$H/home-server/issues/open" "$H/home-server/issues/done"
cp "$R/device/edge/debian/ai-run" "$R/device/edge/debian/ops-auto" "$H/bin/"
printf '#!/bin/sh\n' > "$H/bin/ops-auto-card"
printf '#!/bin/sh\ncase $1 in HS_AUTO_QUOTA_MAX) echo 50 ;; HS_AUTO_PAUSE) echo 0 ;; HS_AUTO_MAX_PER_RUN) echo 1 ;; HS_AUTO_MAX_RUNS) echo 5 ;; *) echo default ;; esac\n' > "$H/.local/bin/hs-setting"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/hs-runlog"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/issues-context"
# claude stub, "$HOME/mode": work (commits "200 passo" changing src.txt), issues (commits
# "issues: update 200" changing only the issue), none (no commit).
cat > "$H/.local/bin/claude" <<'EOF'
#!/bin/sh
cd "$HOME/home-server"
case $(cat "$HOME/mode") in
work) date +%s%N >> src.txt; git add -A; git commit -q -m "200 passo: avanti" ;;
wait) n=$(cat "$HOME/n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$HOME/n"; d=$(date -d "+$n day" +%F); sed -i "/^Not before:/d" issues/open/200-x.md; sed -i "s/^Blocked on: -/Blocked on: -\nNot before: $d/" issues/open/200-x.md; git add -A; git commit -q -m "issues: update 200" ;;
issues) date +%s%N >> issues/open/200-x.md; git add -A; git commit -q -m "issues: update 200" ;;
esac
case $(cat "$HOME/mode") in
login) echo '{"type":"result","subtype":"error","is_error":true,"num_turns":1,"total_cost_usd":0,"result":"Not logged in - Please run /login"}' ;;
*) echo '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"total_cost_usd":0.1}' ;;
esac
EOF
chmod +x "$H/bin/"* "$H/.local/bin/"*
cd "$H/home-server"
git init -q -b main && git config user.name t && git config user.email t@t
echo base > src.txt
export HS_QUEUE_PROJECTS_JSON= HOME="$H" HS_AUTO_QUIET=-2000000000 HS_AUTO_REQUEST="$t/none.json" HS_AUTO_DETAIL="$t/detail.json" HS_ISSUES_JS="$R/device/edge/tracker/issues.js"
ST=$H/.local/state/ops-auto
reset() {
	printf '# Issue A\n\nOpened: 2026-10-15\nBlocked on: -\nStatus: todo\nPriority: high\n\nbody\n' > issues/open/200-x.md
	git add -A && git commit -q --allow-empty -m reset; rm -f "$ST/attempts/"* "$ST/total/"* "$ST/ops-auto.log" "$ST/nowork"* "$ST/notified.log"
}
run() { "$H/bin/ops-auto" > /dev/null 2>&1 || true; }
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
blocked() { sed -n 's/^Blocked on: //p' issues/open/200-x.md; }
runs() { grep -c '#200: run ' "$ST/ops-auto.log" || true; }

reset; echo work > "$H/mode"
run; run; run; run
check "progress: 4 runs, not handed over" "$(blocked)" "-"
check "progress: attempts reset" "$(cat "$ST/attempts/200" 2>/dev/null || echo none)" none
check "progress: log line" "$(grep -c '#200: avanzamento, tentativi azzerati' "$ST/ops-auto.log")" 4
check "progress: total runs kept" "$(cat "$ST/total/200")" 4

reset; echo issues > "$H/mode"
run; run; run
check "issues-only commits: 3 attempts" "$(cat "$ST/attempts/200")" 3
check "issues-only commits: no progress line" "$(grep -c avanzamento "$ST/ops-auto.log" || true)" 0
run
check "issues-only: handed over at the 4th" "$(blocked)" "user (il lavoro automatico non è riuscito a chiuderla in 3 tentativi)"
check "issues-only: 3 runs" "$(runs)" 3

reset; echo none > "$H/mode"
run; run; run; run
check "no commit: handed over at the 4th" "$(grep -c 'handed over after 3 attempts' "$ST/ops-auto.log")" 1

reset; echo work > "$H/mode"
run; run; run; run; run; run
check "max runs: 5 runs" "$(runs)" 5
check "max runs: handed over as troppi giri" "$(blocked)" "user (il lavoro automatico ha fatto 5 giri senza chiuderla, troppi giri)"
check "max runs: log" "$(grep -c 'handed over after 5 runs' "$ST/ops-auto.log")" 1
check "max runs: counters cleared" "$(ls "$ST/total" "$ST/attempts" | grep -c 200 || true)" 0
# declared wait (issue 454): a run that only moves Not before forward does not count
reset; echo wait > "$H/mode"
for i in 1 2 3 4; do run; sed -i "/^Not before:/d" issues/open/200-x.md; git add -A; git commit -q -m "issues: update 200"; done  # the date has passed
check "wait: attempts not counted" "$(cat "$ST/attempts/200" 2>/dev/null || echo 0)" 0
check "wait: not handed over" "$(blocked)" "-"
check "wait: log line" "$(grep -c "attesa dichiarata, tentativo non contato" "$ST/ops-auto.log")" 4

# runs without work (issue 493): login error is no attempt, two in a row pause with one notification
printf '#!/bin/sh\necho "$*" >> "%s/notified.log"\n' "$t" > "$t/notify"; chmod +x "$t/notify"; export HS_NOTIFY="$t/notify"
reset; echo login > "$H/mode"
run
check "login: attempts unchanged" "$(cat "$ST/attempts/200")" 0
check "login: not handed over" "$(blocked)" "-"
run; run; run
check "login: still not handed over" "$(blocked)" "-"
check "login: log line" "$(grep -c 'giro senza lavoro (login dell.AI scaduto), tentativo non contato' "$ST/ops-auto.log")" 2
check "login: paused after 2" "$(test -s "$ST/nowork-until" && echo yes)" yes
check "login: one notification" "$(wc -l < "$t/notified.log")" 1
echo work > "$H/mode"; echo 1 > "$ST/nowork-until"; run
check "login: resumes, flags cleared" "$(ls "$ST" | grep -c '^nowork')" 0
# 3 real failed runs: HITL step with the question
reset; echo none > "$H/mode"
run; run; run; run
check "handover: HITL step" "$(grep -c '^- \[ \] (HITL) Come proseguire' issues/open/200-x.md)" 1
check "handover: Per te" "$(grep -c '^## Per te' issues/open/200-x.md)" 1

exit $fail
