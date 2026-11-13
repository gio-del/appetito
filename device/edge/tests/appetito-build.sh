#!/bin/sh
# Test of the Appetito generator (issue 485): files outside the list are never copied (not tracked,
# not committed, not listed), one commit per publication, no commit without changes, a stale list
# entry is an error, the source history never reaches the copy. Temp repos only.
# From the repo root: device/edge/tests/appetito-build.sh
set -eu
# needs the secrets scanner (issue 529): skipped until the deploy has installed it (hs-scanner-fetch)
[ -x "${HS_GITLEAKS:-/usr/local/lib/hs/gitleaks}" ] || { echo "skip: appetito-build (gitleaks not installed)"; exit 0; }
B=$(pwd)/scripts/appetito-build
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
g() { git -C "$t/src" -c user.name=t -c user.email=t@t -c core.hooksPath=/dev/null "$@"; }
mkdir -p "$t/src/pub/sub" "$t/src/priv" "$t/src/appetito"; git -C "$t/src" init -q -b main
echo a > "$t/src/pub/a.txt"; echo b > "$t/src/pub/sub/b.txt"; echo x > "$t/src/pub/skip.txt"
echo secret > "$t/src/priv/s.txt"; echo top > "$t/src/top.sh"
printf '# lista\npub/\n!pub/skip.txt\ntop.sh\n' > "$t/src/appetito/files"
printf "HS_TS_HOST=zzhost.tailzz.ts.net\n" > "$t/vals"
g add -A; g commit -q -m "one"
echo ignored > "$t/src/pub/untracked.txt"; echo dirty >> "$t/src/pub/a.txt"
sh "$B" "$t/out" --repo "$t/src" --env "$t/vals" >/dev/null
[ -f "$t/out/pub/a.txt" ] && [ -f "$t/out/pub/sub/b.txt" ] && [ -f "$t/out/top.sh" ] || fail "listed files missing"
[ ! -e "$t/out/priv" ] && [ ! -e "$t/out/pub/skip.txt" ] && [ ! -e "$t/out/pub/untracked.txt" ] || fail "file outside the list copied"
[ ! -e "$t/out/appetito" ] || fail "list copied though not listed"
[ "$(cat "$t/out/pub/a.txt")" = a ] || fail "working tree content leaked (should be HEAD)"
[ "$(git -C "$t/out" rev-list --count HEAD)" = 1 ] || fail "first publication = one commit"
sh "$B" "$t/out" --repo "$t/src" --env "$t/vals" | grep -q "nessuna modifica" || fail "no-change run"
[ "$(git -C "$t/out" rev-list --count HEAD)" = 1 ] || fail "commit without changes"
echo b2 > "$t/src/pub/sub/b.txt"; g commit -q -am "two"; echo c > "$t/src/pub/c.txt"; g add -A; g commit -q -m "three"
sh "$B" "$t/out" --repo "$t/src" --env "$t/vals" >/dev/null
[ "$(git -C "$t/out" rev-list --count HEAD)" = 2 ] || fail "two source commits must be one publication commit"
git -C "$t/out" log --format=%s | grep -qxE 'one|two|three|four' && fail "source history leaked"
g rm -q pub/c.txt; g commit -q -m four; sh "$B" "$t/out" --repo "$t/src" --env "$t/vals" >/dev/null
[ ! -e "$t/out/pub/c.txt" ] || fail "removed file stays in the copy"
printf 'nothing/here\n' >> "$t/src/appetito/files"; g commit -q -am five
sh "$B" "$t/out2" --repo "$t/src" --env "$t/vals" 2>/dev/null && fail "stale entry accepted"
echo "ok: appetito-build"
# the check is hooked in: a personal value in a listed file blocks the commit
echo "see zzhost.tailzz.ts.net" > "$t/src/pub/leak.txt"; g add -A; g commit -q -m six
n=$(git -C "$t/out" rev-list --count HEAD)
sh "$B" "$t/out" --repo "$t/src" --env "$t/vals" 2>/dev/null && fail "build published a personal value"
[ "$(git -C "$t/out" rev-list --count HEAD)" = "$n" ] || fail "blocked build still committed"
echo "ok: appetito-build check hook"
