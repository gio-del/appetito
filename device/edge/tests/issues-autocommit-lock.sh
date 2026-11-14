#!/bin/sh
# Test of issue 562: issues-autocommit does not commit while a pre-commit check is running (lock
# .git/hs-commit.lock held by a live process), so a slow commit of another file is not broken by
# HEAD moving; the issue is committed on the next round. Temp repo only.
# From the repo root: device/edge/tests/issues-autocommit-lock.sh
set -eu
R=$(pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/home/home-server/issues/open" "$t/bin"
printf '#!/bin/sh\nexit 0\n' > "$t/bin/issues-housekeep"; chmod +x "$t/bin/issues-housekeep"
# the script calls /usr/local/bin/issues-housekeep: run a copy pointing at the stub
sed "s:/usr/local/bin/issues-housekeep:$t/bin/issues-housekeep:" "$R/device/edge/debian/issues-autocommit" > "$t/ac"
fail() { echo "FAIL: $*"; exit 1; }
cd "$t/home/home-server"
git init -q . && git config user.email t@t && git config user.name t
mkdir hooks; cp "$R/device/edge/git-hooks/pre-commit" hooks/pre-commit
mkdir -p device/edge
printf '#!/bin/sh\nsleep 5\nexit 0\n' > device/edge/check; chmod +x device/edge/check
git config core.hooksPath "$PWD/hooks"
echo a > a.txt; git add a.txt
echo x > issues/open/001-x.md; touch -d '10 minutes ago' issues/open/001-x.md issues/open issues
git commit -q -m first -- a.txt 2>/dev/null &
sleep 1
[ -f .git/hs-commit.lock ] || fail "no lock while the check runs"
HOME="$t/home" sh "$t/ac"
[ -n "$(git status --porcelain -- issues/)" ] || fail "autocommit committed during the slow commit"
wait
[ ! -f .git/hs-commit.lock ] || fail "lock left behind"
git log --format=%s | grep -qx first || fail "slow commit lost"
HOME="$t/home" sh "$t/ac"
[ -z "$(git status --porcelain -- issues/)" ] || fail "issue not committed on the next round"
# stale lock (dead pid) does not block
echo 999999 > .git/hs-commit.lock; echo y >> issues/open/001-x.md; touch -d '10 minutes ago' issues/open/001-x.md issues/open issues
HOME="$t/home" sh "$t/ac"
[ -z "$(git status --porcelain -- issues/)" ] || fail "stale lock blocked"
echo "ok   issues-autocommit-lock"
