#!/bin/sh
# Test of ops-auto working a local issue in its own worktree (issue 636): the run starts in $ST/wt on branch
# ops-auto/NNN, never in the owner's folder; the commits arrive on main with a fast-forward merge (owner's
# uncommitted files untouched); a main that moved on is rebased first; a conflict leaves the branch, comments the
# issue and hands it over; leftovers of an interrupted run stay in the worktree and the next round resumes there;
# the owner's uncommitted files never block a round and nothing is stashed; a claude error cleans the worktree and
# retries once before failing (issue 637).
# Runs ops-auto with a stub claude in a temp HOME/repo. From the repo root: device/edge/tests/ops-auto-worktree.sh
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
# claude stub: mode commit = commit a change of src.txt in its cwd; main = also move main on another file first
# (owner commit); clash = the owner's uncommitted edit of src.txt in the main folder; leave = uncommitted file only.
cat > "$H/.local/bin/claude" <<'EOF'
#!/bin/sh
pwd > "$HOME/cwd"; printf '%s\n' "$2" >> "$HOME/prompts"
m=$(cat "$HOME/mode")
case $m in
commit | clash) echo "mine" >> "$HOME/home-server/owner.txt"; echo "work $(date +%s%N)" >> src.txt; git add -A; git commit -qm "200: work" ;;
leave) echo partial > wip.txt ;;
err) echo partial > wip2.txt; exit 1 ;;
esac
[ "$m" != clash ] || echo owner >> "$HOME/home-server/src.txt"
echo '{"type":"result","subtype":"success","is_error":false,"num_turns":3,"total_cost_usd":0.1}'
EOF
chmod +x "$H/bin/"* "$H/.local/bin/"*
cd "$H/home-server"
git init -q -b main && git config user.name t && git config user.email t@t
printf '# A\n\nOpened: 2026-10-15\nBlocked on: -\nStatus: todo\n\nbody\n' > issues/open/200-x.md
echo base > src.txt; echo o > owner.txt
git add -A && git commit -qm init
export HS_QUEUE_PROJECTS_JSON= HOME="$H" HS_AUTO_QUIET=-2000000000 HS_AUTO_REQUEST="$t/none.json" HS_AUTO_DETAIL="$t/detail.json" HS_ISSUES_JS="$R/device/edge/tracker/issues.js" HS_NOTIFY=/bin/true
ST=$H/.local/state/ops-auto
run() { "$H/bin/ops-auto" > "$t/out" 2>&1 || true; [ -z "${DBG:-}" ] || cat "$t/out"; }
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }

# 1. commit in the worktree, owner's unrelated uncommitted file untouched, fast-forward onto main
echo commit > "$H/mode"; run
check "runs in the worktree" "$(cat "$H/cwd")" "$ST/wt"
check "branch of the issue" "$(git -C "$ST/wt" symbolic-ref --short HEAD)" ops-auto/200
check "ff: commit on main" "$(git log -1 --format=%s)" "200: work"
check "ff: main is the branch" "$(git rev-parse main)" "$(git rev-parse ops-auto/200)"
check "owner's file untouched" "$(git status --porcelain -- owner.txt)" " M owner.txt"
git checkout -q owner.txt

# 2. main moved on meanwhile: rebase, then fast-forward
git checkout -q -b tmp; git checkout -q main; git branch -q -D tmp
echo extra > extra.txt; git add -A; git commit -qm "owner commit"
echo commit > "$H/mode"; run
check "rebase: owner commit kept" "$(git log --format=%s | grep -c 'owner commit')" 1
check "rebase: work on top" "$(git log -1 --format=%s)" "200: work"
check "rebase: linear" "$(git rev-list --merges --count main)" 0

# 3. overlap with the owner's uncommitted file: branch stays, comment, handed over, owner's edit kept
git checkout -q owner.txt
echo clash > "$H/mode"; run
[ -z "${DBG:-}" ] || { tail -6 "$ST/ops-auto.log"; cat issues/open/200-x.md; git status --short; }
check "clash: branch not on main" "$(git merge-base --is-ancestor ops-auto/200 main && echo yes || echo no)" no
check "clash: owner's edit kept" "$(grep -c '^owner$' src.txt)" 1
check "clash: comment names the branch" "$(grep -c '^Il lavoro di questo giro è nel ramo' issues/open/200-x.md)" 1
check "clash: blocked on user" "$(grep -c '^Blocked on: user' issues/open/200-x.md)" 1
check "clash: log" "$(grep -c 'ramo ops-auto/200 non portato' "$ST/ops-auto.log")" 1
check "clash: outcome" "$(grep -c 'round end: lavorato #200: aspetta te' "$ST/ops-auto.log")" 1

# 4. leftovers stay in the worktree; the next round resumes there with the continue prompt
git reset -q --hard; git clean -fdq
sed -i "s/^Blocked on: user.*/Blocked on: -/" issues/open/200-x.md; git add -A; git commit -qm "issues: update 200" || true
git worktree remove --force "$ST/wt"; git branch -q -D ops-auto/200
echo leave > "$H/mode"; run
check "leftover stays in the worktree" "$([ -e "$ST/wt/wip.txt" ] && echo yes || echo no)" yes
check "leftover not in the main folder" "$([ -e wip.txt ] && echo yes || echo no)" no
echo noop > "$H/mode"; run
check "resume: continue prompt" "$(tail -1 "$H/prompts" | grep -c 'continua da lì')" 1
# 5. the owner's uncommitted file never blocks a round (issue 637)
echo dirt > dirt.txt; echo 1 > "$H/p0"; grep -c . "$H/prompts" > "$H/p0"
rm -f "$ST/attempts/200"; run
check "owner's dirty tree: the round runs" "$(( $(grep -c . "$H/prompts") - $(cat "$H/p0") ))" 1
check "owner's dirty tree: no stash" "$(git stash list | wc -l | tr -d ' ')" 0

# 6. a claude error: the worktree is cleaned and retried next round, ops-auto exits 0; the second error exits 1
echo err > "$H/mode"; rc=0; "$H/bin/ops-auto" > /dev/null 2>&1 || rc=$?
check "error 1: exits 0" "$rc" 0
check "error 1: worktree cleaned" "$([ -e "$ST/wt/wip2.txt" ] && echo yes || echo no)" no
check "error 1: log" "$(grep -c 'worktree ripulito' "$ST/ops-auto.log")" 1
rc=0; "$H/bin/ops-auto" > /dev/null 2>&1 || rc=$?
check "error 2: exits 1" "$rc" 1
echo noop > "$H/mode"; rm -f "$ST/attempts/200"; run
check "success clears the retry marker" "$([ -e "$ST/err-retry-200" ] && echo yes || echo no)" no
[ -z "${DBG:-}" ] || { tail -8 "$ST/ops-auto.log"; cat issues/open/200-x.md; }
exit $fail
