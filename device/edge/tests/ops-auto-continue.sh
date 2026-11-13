#!/bin/sh
# Test of ops-auto going on after an issue handed to the owner (issue 106): with
# HS_AUTO_MAX_PER_RUN=3 and queue A, B, A ending "aspetta te" → B is worked in the same round;
# A ending "in corso" → with no progress the round goes on to the next entry once each (issue 215); `--issue A` works only A, whatever its outcome.
# Runs ops-auto with a stub claude in a temp HOME/repo. From the repo root: device/edge/tests/ops-auto-continue.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
H=$t/home
mkdir -p "$H/bin" "$H/.local/bin" "$H/home-server/issues/open" "$H/home-server/issues/done"
cp "$R/device/edge/debian/ai-run" "$R/device/edge/debian/ops-auto" "$H/bin/"
printf '#!/bin/sh\n' > "$H/bin/ops-auto-card"
printf '#!/bin/sh\ncase $1 in HS_AUTO_QUOTA_MAX) echo 50 ;; HS_AUTO_PAUSE) echo 0 ;; HS_AUTO_MAX_PER_RUN) echo 3 ;; *) echo default ;; esac\n' > "$H/.local/bin/hs-setting"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/hs-runlog"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/issues-context"
# claude stub: records the prompt; "$HOME/mode" = handover (sets Blocked on: user on the issue
# it was given) or partial (leaves it as it is: "in corso").
cat > "$H/.local/bin/claude" <<'EOF'
#!/bin/sh
printf '%s\n' "$2" >> "$HOME/prompts"
f=$(printf '%s' "$2" | grep -o 'issues/open/[0-9]*-x.md' | head -1)
[ "$(cat "$HOME/mode")" != handover ] || sed -i 's/^Blocked on: -/Blocked on: user (test)/' "$HOME/home-server/$f"
echo '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"total_cost_usd":0.1}'
EOF
chmod +x "$H/bin/"* "$H/.local/bin/"*
issue() { printf '# %s\n\nOpened: 2026-10-15\nBlocked on: -\nStatus: todo\nPriority: %s\n\nbody\n' "$2" "$3" > "$H/home-server/issues/open/$1-x.md"; }
cd "$H/home-server"
git init -q -b main && git config user.name t && git config user.email t@t
echo base > src.txt
reset() { issue 200 "Issue A" urgent; issue 201 "Issue B" high; git add -A && git commit -q --allow-empty -m reset; rm -f "$H/prompts" "$ST/attempts/"*; }
export HS_QUEUE_PROJECTS_JSON= HOME="$H" HS_AUTO_QUIET=-2000000000 HS_AUTO_REQUEST="$t/none.json" HS_AUTO_DETAIL="$t/detail.json" HS_ISSUES_JS="$R/device/edge/tracker/issues.js"
ST=$H/.local/state/ops-auto
run() { "$H/bin/ops-auto" "$@" > /dev/null 2>&1 || true; }
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
worked() { grep -o 'issues/open/[0-9]*-x.md' "$H/prompts" 2>/dev/null | sed 's|issues/open/||; s|-x.md||' | tr '\n' ' '; }
# ops-auto.log lines of the last round.
lastround() { awk '/round start/ { buf = "" } { buf = buf $0 "\n" } END { printf "%s", buf }' "$ST/ops-auto.log"; }

reset; echo handover > "$H/mode"
run
check "handover: A then B in one round" "$(worked)" "200 201 "
check "handover: one round start" "$(lastround | grep -c 'round start')" 1
check "handover: both in the round log" "$(lastround | grep -cE '#20[01]: aspetta te rc=')" 2

reset; echo partial > "$H/mode"
run
check "in corso without progress: round goes on to B, once each" "$(worked)" "200 201 "

reset; echo handover > "$H/mode"
run --manual --issue 200
check "--issue A, handed over: only A" "$(worked)" "200 "
reset; echo partial > "$H/mode"
run --manual --issue 200
check "--issue A, in corso: only A" "$(worked)" "200 "
exit $fail
