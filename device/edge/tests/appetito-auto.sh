#!/bin/sh
# Test of scripts/appetito-auto (issue 561): the nightly Appetito publication. A fake home-server repo, a bare
# repo playing GitHub (same fake env as appetito-publish.sh), no network. It checks: off by default, a dirty
# work folder is left alone, a first run publishes and notifies, a second one has nothing new, a change in
# home-server publishes again, a rejected push fails the job and leaves the state (so the next night retries).
# From the repo root: device/edge/tests/appetito-auto.sh
set -eu
root=$(pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@localhost GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@localhost
# the fake home-server: scripts + a list, so appetito-auto's "here" is it
mkdir -p "$t/hs/scripts" "$t/hs/appetito"
cp "$root/scripts/appetito-auto" "$root/scripts/appetito-build" "$root/scripts/appetito-publish" "$t/hs/scripts/"
printf "#!/bin/sh\nexit 0\n" > "$t/hs/scripts/appetito-check"  # the real check has its own test
printf 'x.txt\n' > "$t/hs/appetito/files"; echo one > "$t/hs/x.txt"
git -C "$t/hs" init -q -b main; git -C "$t/hs" add -A; git -C "$t/hs" commit -q -m "src one"
git init -q --bare -b main "$t/remote.git"
git clone -q "$t/remote.git" "$t/pub" 2> /dev/null
(cd "$t/pub" && git checkout -q -b main && echo base > base.txt && git add -A && git commit -q -m base && git push -q origin main)
printf 'HS_APPETITO_REPO=someone/appetito\nHS_APPETITO_URL=%s\n' "$t/remote.git" > "$t/env"
printf '#!/bin/sh\necho "$1|$2" >> %s/notified\n' "$t" > "$t/notify"; chmod +x "$t/notify"
printf '#!/bin/sh\n[ "$1" = HS_APPETITO_AUTO ] && cat %s/auto\n' "$t" > "$t/set"; chmod +x "$t/set"
printf '#!/bin/sh\nexit 0\n' > "$t/ok"; chmod +x "$t/ok"
export HS_ENV_FILE="$t/env" HS_PROJECTS_FILE=/dev/null HS_APPETITO_CHECK_CMD="$t/ok" HS_APPETITO_SELFCHECK_CMD="$t/ok" HS_SECRETS_CMD="$t/ok" HS_ATTRIBUTION_CMD="$t/ok" HS_GIT_TOKEN="$t/none"
export HS_SETTING_CMD="$t/set" HS_NOTIFY="$t/notify" HS_APPETITO_AUTO_STATE="$t/state"
export APPETITO_AUTO_BUILD_ARGS="--env $t/env"
A="sh $t/hs/scripts/appetito-auto $t/pub"
remote() { git -C "$t/remote.git" rev-parse main; }
base=$(remote)

echo 0 > "$t/auto"
out=$($A 2>&1) || fail "off: $out"
echo "$out" | grep -q spenta || fail "off message: $out"
[ "$(remote)" = "$base" ] || fail "off published"

echo 1 > "$t/auto"
echo x > "$t/pub/dirty"
out=$($A 2>&1) && fail "dirty accepted: $out"
echo "$out" | grep -q "non committate" || fail "dirty message: $out"
rm "$t/pub/dirty"

out=$($A 2>&1) || fail "first run: $out"
echo "$out" | grep -q "^pubblicato " || fail "first run message: $out"
[ "$(remote)" != "$base" ] || fail "first run did not publish"
[ "$(git -C "$t/remote.git" show main:x.txt)" = one ] || fail "file not published"
[ -s "$t/notified" ] || fail "no notification"
first=$(remote)
out=$($A 2>&1) || fail "second run: $out"
echo "$out" | grep -q "niente di nuovo" || fail "second message: $out"
[ "$(remote)" = "$first" ] || fail "second run moved the remote"

echo two > "$t/hs/x.txt"; git -C "$t/hs" commit -q -am "src two"
printf '#!/bin/sh\nexit 1\n' > "$t/remote.git/hooks/pre-receive"; chmod +x "$t/remote.git/hooks/pre-receive"
out=$($A 2>&1) && fail "rejected push accepted: $out"
echo "$out" | grep -q "rifiutata" || fail "rejected message: $out"
[ "$(remote)" = "$first" ] || fail "rejected moved the remote"
rm "$t/remote.git/hooks/pre-receive"
out=$($A 2>&1) || fail "retry: $out"
[ "$(git -C "$t/remote.git" show main:x.txt)" = two ] || fail "change not published on retry"
echo "ok: appetito-auto"
