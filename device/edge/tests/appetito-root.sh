#!/bin/sh
# Test of the root files of Appetito's copy (issue 564): a listed file under appetito/root/ lands at the root
# of the copy (appetito/root/README.md -> README.md), nested folders too; appetito-build --files keeps the source
# paths (appetito-propose), --paths gives the published ones (appetito-publish); a name that collides with
# another listed file is an error; root files that are not listed are not copied. Temp repos only.
# From the repo root: device/edge/tests/appetito-root.sh
set -eu
[ -x "${HS_GITLEAKS:-/usr/local/lib/hs/gitleaks}" ] || { echo "skip: appetito-root (gitleaks not installed)"; exit 0; }
B=$(pwd)/scripts/appetito-build
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
g() { git -C "$t/src" -c user.name=t -c user.email=t@t -c core.hooksPath=/dev/null "$@"; }
mkdir -p "$t/src/pub" "$t/src/appetito/root/.github"; git -C "$t/src" init -q -b main
echo a > "$t/src/pub/a.txt"; echo "private readme" > "$t/src/README.md"
echo "public readme" > "$t/src/appetito/root/README.md"; echo lic > "$t/src/appetito/root/LICENSE"; echo f > "$t/src/appetito/root/.github/FUNDING.yml"
printf 'pub/\nappetito/files\n' > "$t/src/appetito/files"
printf "HS_TS_HOST=zzhost.tailzz.ts.net\n" > "$t/vals"
g add -A; g commit -q -m one
# not listed: nothing of appetito/root reaches the copy, and the private README never does
sh "$B" "$t/out" --repo "$t/src" --env "$t/vals" > /dev/null
[ ! -e "$t/out/README.md" ] && [ ! -e "$t/out/LICENSE" ] && [ ! -e "$t/out/appetito/root" ] || fail "unlisted root file copied"
# listed: at the root of the copy, with the public text
printf 'pub/\nappetito/files\nappetito/root/\n' > "$t/src/appetito/files"; g commit -q -am two
out=$(sh "$B" "$t/out" --repo "$t/src" --env "$t/vals") || fail "build with root files: $out"
[ "$(cat "$t/out/README.md")" = "public readme" ] || fail "README is not the public one"
[ -f "$t/out/LICENSE" ] && [ -f "$t/out/.github/FUNDING.yml" ] || fail "root files missing"
[ ! -e "$t/out/appetito/root" ] || fail "appetito/root left in the copy"
[ -f "$t/out/appetito/files" ] || fail "the list itself went missing"
echo "$out" | grep -q ": 5 file" || fail "file count: $out"
# --files = source paths, --paths = published paths, and the copy has exactly the published ones
[ "$(sh "$B" --files --repo "$t/src" | tr '\n' ' ')" = "appetito/files appetito/root/.github/FUNDING.yml appetito/root/LICENSE appetito/root/README.md pub/a.txt " ] || fail "--files: $(sh "$B" --files --repo "$t/src" | tr '\n' ' ')"
sh "$B" --paths --repo "$t/src" > "$t/paths"
git -C "$t/out" ls-files | sort > "$t/have"
cmp -s "$t/paths" "$t/have" || fail "--paths differs from the copy: $(tr '\n' ' ' < "$t/paths") / $(tr '\n' ' ' < "$t/have")"
grep -qx README.md "$t/paths" && ! grep -q '^appetito/root' "$t/paths" || fail "--paths not mapped"
# a second run changes nothing
sh "$B" "$t/out" --repo "$t/src" --env "$t/vals" | grep -q "nessuna modifica" || fail "second run committed"
# collision: the same published path twice is refused, nothing committed
n=$(git -C "$t/out" rev-list --count HEAD)
printf 'pub/\nappetito/files\nappetito/root/\nREADME.md\n' > "$t/src/appetito/files"; g commit -q -am three
sh "$B" "$t/out" --repo "$t/src" --env "$t/vals" > "$t/err" 2>&1 && fail "collision accepted"
grep -q "stesso percorso" "$t/err" || fail "collision message: $(cat "$t/err")"
[ "$(git -C "$t/out" rev-list --count HEAD)" = "$n" ] || fail "collision still committed"
[ "$(cat "$t/out/README.md")" = "public readme" ] || fail "collision overwrote the copy"
echo "ok: appetito-root"
