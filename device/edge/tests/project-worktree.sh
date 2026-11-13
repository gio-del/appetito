#!/bin/sh
# Test of project-worktree (issue 187) with a temporary upstream repo.
# From the repo root: device/edge/tests/project-worktree.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
export GIT_CONFIG_GLOBAL=$t/gitconfig GIT_CONFIG_SYSTEM=/dev/null
git config --global user.email t@t; git config --global user.name t; git config --global init.defaultBranch main
git init -q "$t/up"; echo one > "$t/up/f"; git -C "$t/up" add f; git -C "$t/up" commit -qm one
mkdir "$t/proj"; git clone -q "$t/up" "$t/proj/p"
export HS_PROJECTS_DIR=$t/proj HS_WORK_DIR=$t/work
W="sh $R/device/edge/debian/project-worktree"
fail() { echo "FAIL: $1"; exit 1; }

echo two > "$t/up/f"; git -C "$t/up" commit -qam two   # new upstream commit: create must fetch it
d=$($W create p 221 "Fix: The Bug!!")
[ "$d" = "$t/work/p-221" ] || fail "path $d"
[ "$(cat "$d/f")" = two ] || fail "not from fetched origin/main"
[ "$(git -C "$d" symbolic-ref --short HEAD)" = issue/221-fix-the-bug ] || fail "branch name"
[ -z "$(git -C "$t/proj/p" status --porcelain)" ] || fail "owner tree touched"
[ "$(git -C "$t/proj/p" symbolic-ref --short HEAD)" = main ] || fail "owner branch changed"
dacc=$($W create p 300 "Limita i tentativi di accesso in modalità LAN, con un titolo lungo")
[ "$(git -C "$dacc" symbolic-ref --short HEAD)" = issue/300-limita-i-tentativi-di-accesso-in ] || fail "slug accent/boundary: $(git -C "$dacc" symbolic-ref --short HEAD)"
$W remove p 300 >/dev/null 2>&1 || true
echo wip > "$d/new"
[ "$($W create p 221 other)" = "$d" ] && [ -e "$d/new" ] || fail "resume lost work"
[ "$($W path p 221)" = "$d" ] || fail "path"
$W path p 999 && fail "path of missing worktree"
$W create p 22x s 2> /dev/null && fail "bad number accepted"
$W create '../p' 1 s 2> /dev/null && fail "bad name accepted"
$W create nope 1 s 2> /dev/null && fail "missing Project accepted"
# remove: unmerged commit keeps the branch, empty branch is deleted
git -C "$d" add new; git -C "$d" commit -qm "p#221: x"
$W remove p 221 2> /dev/null
[ ! -e "$d" ] || fail "worktree left"
git -C "$t/proj/p" rev-parse -q --verify refs/heads/issue/221-fix-the-bug > /dev/null || fail "unmerged branch deleted"
d2=$($W create p 221 whatever)   # resumes the kept branch
[ -e "$d2/new" ] || fail "kept branch not resumed"
$W remove p 221 2> /dev/null
d3=$($W create p 5 empty); $W remove p 5
git -C "$t/proj/p" rev-parse -q --verify refs/heads/issue/5-empty > /dev/null && fail "empty branch kept"
$W remove p 5   # idempotent
git -C "$t/proj/p" branch claude/7-old main
d4=$($W create p 7 x)
[ "$(git -C "$d4" symbolic-ref --short HEAD)" = issue/7-old ] || fail "legacy claude/ branch not renamed"
$W remove p 7 2> /dev/null
# prune (issue 295): stub projects-publish says merged for issue/31, none otherwise
mkdir "$t/bin"; printf '#!/bin/sh\n[ "$3" = issue/31-merged ] && echo merged || echo none\n' > "$t/bin/projects-publish"; chmod +x "$t/bin/projects-publish"
export PATH=$t/bin:$PATH HS_LEFTOVERS_DIR=$t/left HS_OPSAUTO_LOCK=$t/lock
P="$t/proj/p"
for spec in 31:merged 32:open 33:dirty 34:empty; do
	n=${spec%%:*}; k=${spec##*:}; d=$($W create p $n $k)
	[ "$k" = empty ] || { echo "$k" > "$d/$k"; git -C "$d" add "$k"; git -C "$d" commit -qm "p#$n"; }
	[ "$k" != dirty ] || echo x > "$d/untracked"
done
git -C "$P" branch claude/40-empty main
git -C "$P" branch claude/41-work main; git -C "$P" worktree add -q "$t/c41" claude/41-work; echo c > "$t/c41/c"; git -C "$t/c41" add c; git -C "$t/c41" commit -qm c; git -C "$P" worktree remove --force "$t/c41"
# ops-auto running: nothing happens
exec 7>>"$t/lock"; flock -n 7
$W prune p; git -C "$P" rev-parse -q --verify refs/heads/issue/31-merged > /dev/null || fail "pruned while ops-auto runs"
exec 7>&-
$W prune p
git -C "$P" rev-parse -q --verify refs/heads/issue/31-merged > /dev/null && fail "merged branch kept"
[ ! -e "$t/work/p-31" ] || fail "merged worktree kept"
git -C "$P" rev-parse -q --verify refs/heads/issue/32-open > /dev/null || fail "unmerged branch deleted"
git -C "$P" rev-parse -q --verify refs/heads/issue/33-dirty > /dev/null && [ -e "$t/work/p-33/untracked" ] || fail "dirty worktree touched"
git -C "$P" rev-parse -q --verify refs/heads/issue/34-empty > /dev/null || fail "empty branch with fresh worktree deleted before a day"
git -C "$P" rev-parse -q --verify refs/heads/claude/40-empty > /dev/null && fail "empty claude branch kept"
git -C "$P" rev-parse -q --verify refs/heads/claude/41-work > /dev/null || fail "claude branch with commits deleted"
grep -q '^issue/32-open: 1 commit' "$t/left/p" && grep -q 'issue/33-dirty: worktree sporco' "$t/left/p" && grep -q 'claude/41-work: 1 commit' "$t/left/p" || fail "leftovers not listed"
grep -q 'issue/31' "$t/left/p" && fail "merged listed as leftover"
touch -d '3 days ago' "$t/work/p-34"; $W prune p
git -C "$P" rev-parse -q --verify refs/heads/issue/34-empty > /dev/null && fail "old empty worktree kept"
echo "project-worktree: OK"
