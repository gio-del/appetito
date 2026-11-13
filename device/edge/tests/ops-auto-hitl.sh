#!/bin/sh
# Round of ops-auto on an issue the owner answered with Rispondi (issue 173): given the answered issue
# file ($1: steps 1 and 3 ticked, step 2 still open), the queue offers it and the prompt sent to claude
# names it; the stub claude sees the open (HITL) step. Temp HOME/repo. From the repo root: device/edge/tests/ops-auto-hitl.sh FILE
set -eu
[ $# -ge 1 ] || { echo "skip: needs the answered issue file (run by tracker-ui.js)"; exit 0; }
R=$(pwd); src=$1
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
H=$t/home
mkdir -p "$H/bin" "$H/.local/bin" "$H/home-server/issues/open" "$H/home-server/issues/done"
cp "$R/device/edge/debian/ai-run" "$R/device/edge/debian/ops-auto" "$R/device/edge/debian/ops-auto-request" "$H/bin/"
printf '#!/bin/sh\n' > "$H/bin/ops-auto-card"
printf '#!/bin/sh\ncase $1 in HS_AUTO_QUOTA_MAX) echo 50 ;; HS_AUTO_PAUSE) echo 0 ;; HS_AUTO_MAX_PER_RUN) echo 1 ;; *) echo default ;; esac\n' > "$H/.local/bin/hs-setting"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/hs-runlog"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/issues-context"
printf '#!/bin/sh\n' > "$H/.local/bin/hs-run"
cat > "$H/.local/bin/claude" <<'EOS'
#!/bin/sh
printf '%s\n' "$2" >> "$HOME/prompts"
f=$(ls "$HOME"/home-server/issues/open/*.md | head -1)
grep -c '^- \[ \] (HITL) Secondo?' "$f" > "$HOME/open-hitl"
grep -c '^- \[x\] (HITL) Primo?' "$f" > "$HOME/ticked1"
echo '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"total_cost_usd":0.1}'
EOS
chmod +x "$H/bin/"* "$H/.local/bin/"*
cp "$src" "$H/home-server/issues/open/019-tre-passi-hitl.md"
cd "$H/home-server"; git init -q -b main && git config user.name t && git config user.email t@t
git add -A && git commit -qm init
export HS_QUEUE_PROJECTS_JSON= HOME="$H" HS_AUTO_QUIET=-2000000000 HS_AUTO_REQUEST="$t/none.json" HS_AUTO_DETAIL="$t/detail.json" HS_ISSUES_JS="$R/device/edge/tracker/issues.js"
"$H/bin/ops-auto" > /dev/null 2>&1 || true
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
check "round: claude got the issue" "$(grep -c 'issues/open/019-tre-passi-hitl.md' "$H/prompts" 2>/dev/null || echo 0)" 1
check "round: step 2 still open" "$(cat "$H/open-hitl" 2>/dev/null || echo none)" 1
check "round: step 1 ticked" "$(cat "$H/ticked1" 2>/dev/null || echo none)" 1
exit $fail
