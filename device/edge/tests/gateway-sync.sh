#!/bin/sh
# Test of gateway-sync's safe pull and of projects-check (issue 180), with a bare repo as origin,
# throwaway HOME and a stubbed project list: clean+behind fast-forwards; dirty, ahead, other branch
# and ops-auto running leave the clone intact with the reason in GATEWAY.md; an unreachable origin
# warns and exits 0; a row without URL is refused by projects-check.
# From the repo root: device/edge/tests/gateway-sync.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
mkdir -p "$t/home/projects" "$t/home/.local/state/ops-auto" "$t/bin"
G=$t/home/projects
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
git init -q --bare -b main "$t/origin.git"
git clone -q "$t/origin.git" "$t/work" 2>/dev/null
echo 1 > "$t/work/a"; git -C "$t/work" add a; git -C "$t/work" commit -qm one; git -C "$t/work" push -q origin main
# gateway-sync calls /usr/local/bin/gateway-projects: run a copy with the path replaced.
sed -e "s#/usr/local/bin/gateway-projects#$t/bin/gp#" -e "s#/usr/local/bin/projects-git#$R/device/edge/debian/projects-git#" "$R/device/edge/debian/gateway-sync" > "$t/bin/gs"
printf '#!/bin/sh\necho "p %s - active - -"\n' "$t/origin.git" > "$t/bin/gp"
chmod +x "$t/bin/gs" "$t/bin/gp"
sync() { HOME=$t/home HS_OPSAUTO_LOCK=$t/home/.local/state/ops-auto/lock sh "$t/bin/gs" 2>&1; }
fail() { echo "FAIL: $1"; cat "$G/GATEWAY.md" 2>/dev/null; exit 1; }
push() { echo "$1" >> "$t/work/a"; git -C "$t/work" commit -qam "$1"; git -C "$t/work" push -q origin main; }

sync > /dev/null
[ -d "$G/p/.git" ] || fail "not cloned"
push two
sync | grep -q "fast-forwarded 1" || fail "clean and behind: no fast-forward"
[ "$(git -C "$G/p" rev-parse HEAD)" = "$(git -C "$t/work" rev-parse HEAD)" ] || fail "HEAD not at origin"

push three
echo x >> "$G/p/a"
sync > /dev/null
grep -q "dirty" "$G/GATEWAY.md" || fail "dirty not reported"
[ "$(cat "$G/p/a" | tail -1)" = x ] || fail "dirty tree touched"
[ "$(git -C "$G/p" rev-list --count HEAD..origin/main)" = 1 ] || fail "dirty clone moved"
git -C "$G/p" checkout -q a

echo y > "$G/p/untracked"
sync > /dev/null; grep -q "dirty" "$G/GATEWAY.md" || fail "untracked file not reported as dirty"
rm "$G/p/untracked"

exec 7>>"$t/home/.local/state/ops-auto/lock"; flock -n 7
sync > /dev/null; grep -q "in uso" "$G/GATEWAY.md" || fail "ops-auto running not reported"
exec 7>&-
sync | grep -q "fast-forwarded 1" || fail "no fast-forward once free"

echo l > "$G/p/l"; git -C "$G/p" add l; git -C "$G/p" commit -qm local; push four
sync > /dev/null; grep -q "ahead 1" "$G/GATEWAY.md" || fail "ahead not reported"
git -C "$G/p" reset -q --hard origin/main~0 2>/dev/null || true
git -C "$G/p" checkout -q -b other
sync > /dev/null; grep -q "su other" "$G/GATEWAY.md" || fail "other branch not reported"
[ "$(git -C "$G/p" symbolic-ref --short HEAD)" = other ] || fail "branch switched"

mv "$t/origin.git" "$t/gone.git"
sync | grep -q "origin unreachable" || fail "unreachable origin not warned"
sync > /dev/null || fail "unreachable origin: non-zero exit"
mv "$t/gone.git" "$t/origin.git"

printf 'home-server | - | - | active | issues | -\nx | - | - | active | - | -\n' > "$t/list"
if HS_PROJECTS_NO_REMOTE=1 "$R/device/edge/projects-check" "$t/list" 2>"$t/err"; then fail "row without URL accepted"; fi
grep -q "x has no git URL" "$t/err" || fail "projects-check message"
printf 'home-server | - | - | active | issues | -\n' > "$t/list"
HS_PROJECTS_NO_REMOTE=1 "$R/device/edge/projects-check" "$t/list" || fail "home-server without URL refused"
printf 'p | %s | - | active | - | -\n' "$t/origin.git" > "$t/list"
"$R/device/edge/projects-check" "$t/list" || fail "readable remote refused"
printf 'p | %s/none.git | - | active | - | -\n' "$t" > "$t/list"
if "$R/device/edge/projects-check" "$t/list" 2>/dev/null; then fail "unreadable remote accepted"; fi
mkdir -p "$t/home/.local/state/ops-auto/leftovers"; printf 'issue/9-x: 2 commit, PR none (non unita)\n' > "$t/home/.local/state/ops-auto/leftovers/p"
rm -f "$G/GATEWAY.md.bak"; sync > /dev/null; grep -q "rimasti: issue/9-x: 2 commit" "$G/GATEWAY.md" || fail "leftovers not in GATEWAY.md"
rm "$t/home/.local/state/ops-auto/leftovers/p"

echo "gateway-sync: ok"
