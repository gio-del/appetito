#!/bin/sh
# Test of bin/app-upgrade (issue 115) on a throwaway repo, with a stub deploy and a fake npm (bw-cli).
# Run from the repo root: device/edge/tests/app-upgrade.sh
set -eu
UP=$PWD/device/edge/debian/app-upgrade
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/repo/device/edge/debian" "$t/home/bin" "$t/path"
printf '#!/bin/sh\n# test\nPIN_BW=2026.9.1\n[ "${1:-}" = --pin ] && { echo "$PIN_BW"; exit 0; }\n' > "$t/repo/device/edge/debian/rotate-secrets"
# npm view @bitwarden/cli@V version: V exists unless it is 9.9.9.
printf '#!/bin/sh\nv=${2#@bitwarden/cli@}; [ "$v" = 9.9.9 ] || echo "$v"\n' > "$t/path/npm"
# Deploy stub: installs rotate-secrets like the real deploy; fails on a pin of 2027.2.0.
printf '#!/bin/sh\ninstall -m 755 device/edge/debian/rotate-secrets "$HOME/bin/rotate-secrets"\n! grep -q "^PIN_BW=2027.2.0" device/edge/debian/rotate-secrets\n' > "$t/deploy"
chmod 755 "$t/path/npm" "$t/deploy" "$t/repo/device/edge/debian/rotate-secrets"
git -C "$t/repo" init -q && git -C "$t/repo" add -A && git -C "$t/repo" -c user.name=t -c user.email=t@t commit -qm init
run() { HOME=$t/home PATH=$t/path:$PATH GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t \
	HS_UPGRADE_REPO=$t/repo HS_UPGRADE_DEPLOY=$t/deploy HS_UPGRADE_LOCK=$t/lock HS_UPGRADE_PROBE=true "$UP" "$@" > "$t/log" 2>&1 && echo 0 || echo $?; }
pin() { sed -n 's/^PIN_BW=//p' "$t/repo/device/edge/debian/rotate-secrets"; }
fail() { echo "FAIL: app-upgrade: $*"; cat "$t/log"; exit 1; }
# 1. a good minor: pin bumped, committed, deployed.
[ "$(run bw-cli 2027.1.0)" = 0 ] && [ "$(pin)" = 2027.1.0 ] && [ "$("$t/home/bin/rotate-secrets" --pin)" = 2027.1.0 ] || fail "good upgrade"
git -C "$t/repo" log -1 --format=%s | grep -q "^bw-cli: 2027.1.0" || fail "commit message"
# 2. a deploy that breaks: reverted, redeployed, exit 1.
[ "$(run bw-cli 2027.2.0)" = 1 ] && [ "$(pin)" = 2027.1.0 ] && [ "$("$t/home/bin/rotate-secrets" --pin)" = 2027.1.0 ] || fail "revert"
git -C "$t/repo" log -1 --format=%s | grep -q "^Revert" && grep -q "reverted" "$t/log" || fail "revert commit"
# 3. a version upstream doesn't have: nothing changes.
n=$(git -C "$t/repo" rev-list --count HEAD)
[ "$(run bw-cli 9.9.9)" = 1 ] && [ "$(git -C "$t/repo" rev-list --count HEAD)" = "$n" ] || fail "missing version"
# 4. uncommitted work outside issues/, or ops-auto running: busy (75), nothing changes.
echo x >> "$t/repo/device/edge/debian/other"
[ "$(run bw-cli 2027.3.0)" = 75 ] && [ "$(pin)" = 2027.1.0 ] || fail "dirty tree"
rm "$t/repo/device/edge/debian/other"
[ "$(flock "$t/lock" sh -c "HOME=$t/home PATH=$t/path:\$PATH HS_UPGRADE_REPO=$t/repo HS_UPGRADE_DEPLOY=$t/deploy HS_UPGRADE_LOCK=$t/lock HS_UPGRADE_PROBE=true $UP bw-cli 2027.3.0 >/dev/null 2>&1 && echo 0 || echo \$?")" = 75 ] || fail "lock"
# 5. unsupported app or bad version: usage (2).
[ "$(run sumisura v0.5.0)" = 2 ] && [ "$(run bw-cli 'v1;rm')" = 2 ] || fail "usage"
# 6. homepage is gone (issue 109): not a supported app any more.
[ "$(run homepage v9.8.7)" = 2 ] || fail "homepage still accepted"
echo "ok: app-upgrade"
