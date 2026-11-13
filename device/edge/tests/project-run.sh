#!/bin/sh
# Test of project-run (issue 187): runs as another user, no-new-privs, no ~/.secrets, committed state only.
# Needs passwordless sudo (skipped otherwise). From the repo root: device/edge/tests/project-run.sh
set -eu
R=$(pwd)
sudo -n true 2> /dev/null || { echo "skip: no sudo"; exit 0; }
t=$(mktemp -d)
chmod 755 "$t"
trap 'sudo rm -rf "$t"' EXIT
export GIT_CONFIG_GLOBAL=$t/gitconfig GIT_CONFIG_SYSTEM=/dev/null
git config --global user.email t@t; git config --global user.name t; git config --global init.defaultBranch main
git init -q "$t/up"; echo one > "$t/up/f"; git -C "$t/up" add f; git -C "$t/up" commit -qm one
mkdir -p "$t/proj"; git clone -q "$t/up" "$t/proj/p"
mkdir -p "$t/work"; chmod 700 "$t/work"
export HS_PROJECTS_DIR=$t/proj HS_WORK_DIR=$t/work
d=$(sh "$R/device/edge/debian/project-worktree" create p 7 t)
printf '#!/bin/sh\nid -u; grep NoNewPrivs /proc/self/status; pwd; cat f; cat "$1" 2>&1; echo "$HOME"; exit 3\n' > "$d/t.sh"
git -C "$d" add t.sh; git -C "$d" commit -qm "p#7: t"
echo uncommitted > "$d/f"
printf 'p | https://x/p.git | - | active | - | -\nq | https://x/q.git | sumisura | active | - | -\n' > "$t/projects"
P="sudo -n env HS_PROJECTS_FILE=$t/projects HS_WORK_DIR=$t/work HS_USER=$(id -un) sh $R/device/edge/debian/project-run"
fail() { echo "FAIL: $1"; exit 1; }
secret=$HOME/.secrets/$(ls "$HOME/.secrets" | head -n1)
rc=0; out=$($P p "$d" sh ./t.sh "$secret") || rc=$?
[ "$rc" = 3 ] || fail "exit status $rc"
echo "$out" | grep -qx 902 || fail "not hs-build: $out"
echo "$out" | grep -q 'NoNewPrivs:.1' || fail "no_new_privs"
echo "$out" | grep -qx one || fail "not the committed state: $out"
echo "$out" | grep -qi 'denied' || fail "secret readable: $out"
echo "$out" | grep -q "^/var/tmp/project-run" || fail "cwd/HOME: $out"
[ -z "$(ls -d /var/tmp/project-run.* 2> /dev/null)" ] || fail "temp dir left"
$P p /etc sh -c true 2> /dev/null && fail "worktree outside work dir"
$P p "$d/.." sh -c true 2> /dev/null && fail "parent dir accepted"
$P nope "$d" sh -c true 2> /dev/null && fail "unknown Project"
$P '../p' "$d" sh -c true 2> /dev/null && fail "bad name"
rc=0; HS_RUN_TIMEOUT=1 sudo -n env HS_RUN_TIMEOUT=1 HS_PROJECTS_FILE="$t/projects" HS_WORK_DIR="$t/work" HS_USER=$(id -un) sh "$R/device/edge/debian/project-run" p "$d" sleep 5 || rc=$?
[ "$rc" = 124 ] || fail "timeout rc $rc"
echo ok
