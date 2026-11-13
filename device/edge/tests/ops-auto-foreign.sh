#!/bin/sh
# Test of ops-auto not claiming another session's work (issue 451): during the run a stub "claude"
# writes src.txt (its Write is in the stream) and, like another session, other.txt (not in the stream).
# The issue is closed with uncommitted work: src.txt goes into the stash named after the issue, other.txt
# into a neutral stash with an hs-notify, and the issue gets no note about other.txt.
# From the repo root: device/edge/tests/ops-auto-foreign.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
H=$t/home
mkdir -p "$H/bin" "$H/.local/bin" "$H/home-server/issues/open" "$H/home-server/issues/done"
cp "$R/device/edge/debian/ai-run" "$R/device/edge/debian/ops-auto" "$H/bin/"
printf '#!/bin/sh\n' > "$H/bin/ops-auto-card"
printf '#!/bin/sh\ncase $1 in HS_AUTO_QUOTA_MAX) echo 50 ;; HS_AUTO_PAUSE) echo 0 ;; HS_AUTO_MAX_PER_RUN) echo 1 ;; *) echo default ;; esac\n' > "$H/.local/bin/hs-setting"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/hs-runlog"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/issues-context"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/hs-run"
printf '#!/bin/sh\necho "$*" >> "$HOME/notify.calls"\n' > "$t/notify"
cat > "$H/.local/bin/claude" <<'EOF2'
#!/bin/sh
cd "$HOME/home-server"
echo mine >> src.txt
echo theirs > other.txt
echo "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Write\",\"input\":{\"file_path\":\"$HOME/home-server/src.txt\"}}]}}"
git mv issues/open/200-x.md issues/done/200-x.md
echo '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"total_cost_usd":0.1}'
EOF2
chmod +x "$H/bin/"* "$H/.local/bin/"* "$t/notify"
cd "$H/home-server"
git init -q -b main && git config user.name t && git config user.email t@t
printf '# A\n\nOpened: 2026-10-15\nBlocked on: -\nStatus: todo\nPriority: high\n\nbody\n' > issues/open/200-x.md
echo base > src.txt; git add -A && git commit -qm init
export HS_QUEUE_PROJECTS_JSON= HOME="$H" HS_AUTO_QUIET=-2000000000 HS_AUTO_REQUEST="$t/none.json" HS_AUTO_DETAIL="$t/detail.json" HS_ISSUES_JS="$R/device/edge/tracker/issues.js" HS_NOTIFY="$t/notify"
"$H/bin/ops-auto" > /dev/null 2>&1 || true
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
check "own stash named after the issue" "$(git stash list | grep -c 'ops-auto #200')" 1
check "neutral stash for the other session" "$(git stash list | grep -c 'altra sessione trovate a fine giro #200')" 1
n1=$(git stash list | grep "ops-auto #200" | cut -d: -f1); n2=$(git stash list | grep "altra sessione" | cut -d: -f1)
check "own stash holds src.txt" "$(git stash show --include-untracked --name-only "$n1" | grep -c '^src.txt$')" 1
check "other stash holds other.txt, not src.txt" "$(git stash show --include-untracked --name-only "$n2" | grep -c '^other.txt$')" 1
check "other stash does not hold src.txt" "$(git stash show --include-untracked --name-only "$n2" | grep -c '^src.txt$')" 0
check "tree clean afterwards" "$(git status --porcelain -- . ':!issues' | wc -l)" 0
check "notice sent" "$(grep -c 'modifiche non sue' "$H/notify.calls")" 1
check "no note about other.txt in the issue" "$(grep -c 'other.txt' issues/done/200-x.md)" 0
exit $fail
