#!/bin/sh
# Test of hs-docs-fetch (issue 125) on a fake local archive: sha256 right/wrong, text-only, no-op, pruning.
# Run from the repo root: device/edge/tests/hs-docs-fetch.sh
set -eu
F=$PWD/device/edge/debian/hs-docs-fetch
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/src/app-1/docs/sub" "$t/local"
echo "# Config" > "$t/src/app-1/docs/config.md"
echo "<p>Hello &amp; <b>bye</b></p>" > "$t/src/app-1/docs/sub/page.html"
printf '\000\001binary' > "$t/src/app-1/docs/blob.md"
echo "img" > "$t/src/app-1/docs/pic.png"
echo "changes" > "$t/src/app-1/CHANGELOG.md"
echo "# Page" > "$t/src/app-1/docs/page.mdx"
tar -czf "$t/a.tar.gz" -C "$t/src" app-1
sha=$(sha256sum < "$t/a.tar.gz" | cut -c1-64)
echo "local changelog" | gzip > "$t/local/changelog.gz"
run() { HS_DOCS_LIST=$t/list HS_DOCS_DIR=$t/out HS_DOCS_SV=$t/none "$F" > "$t/log" 2>&1 && echo 0 || echo $?; }
fail() { echo "FAIL: hs-docs-fetch: $*"; cat "$t/log"; exit 1; }
# 1. right sha256: docs + local changelog installed, binary/image dropped, HTML as text, INDEX.
printf 'fake | 1.0 | file://%s | %s | docs CHANGELOG.md\nfake | 1.0 | local | - | %s\n' "$t/a.tar.gz" "$sha" "$t/local/changelog.gz" > "$t/list"
[ "$(run)" = 0 ] || fail "install"
V=$t/out/fake/1.0
[ -f "$V/docs/config.md" ] && [ -f "$V/CHANGELOG.md" ] && [ "$(cat "$V/changelog")" = "local changelog" ] || fail "files"
[ -f "$V/docs/page.mdx" ] || fail "mdx dropped"
[ ! -e "$V/docs/blob.md" ] && [ ! -e "$V/docs/pic.png" ] || fail "binary kept"
[ "$(cat "$V/docs/sub/page.txt")" = "Hello & bye" ] || fail "html to text"
grep -q '^## fake 1.0' "$t/out/INDEX.md" && grep -q 'CHANGELOG.md' "$t/out/INDEX.md" || fail "index"
# 2. same list again: no-op, no output.
[ "$(run)" = 0 ] && [ ! -s "$t/log" ] || fail "no-op"
# 3. wrong sha256 for a new version: exit 1, nothing installed, old version kept.
printf 'fake | 2.0 | file://%s | %s | docs\n' "$t/a.tar.gz" "$(echo "$sha" | tr 0-9a-f 1-9a-f0)" > "$t/list"
[ "$(run)" = 1 ] && grep -q "sha256 mismatch" "$t/log" && [ -d "$V" ] && [ ! -e "$t/out/fake/2.0" ] || fail "bad sha256"
# 4. right sha256 for 2.0: 2.0 installed, 1.0 removed; an app dropped from the list is removed.
mkdir -p "$t/out/gone/3"
printf 'fake | 2.0 | file://%s | %s | docs\n' "$t/a.tar.gz" "$sha" > "$t/list"
[ "$(run)" = 0 ] && [ -f "$t/out/fake/2.0/docs/config.md" ] && [ ! -e "$V" ] && [ ! -e "$t/out/gone" ] || fail "prune"
# 5. size limit and path outside the archive: refused.
[ "$(HS_DOCS_MAXKB=0 HS_DOCS_LIST=$t/list HS_DOCS_DIR=$t/out2 HS_DOCS_SV=$t/none "$F" > "$t/log" 2>&1 && echo 0 || echo $?)" = 1 ] && [ ! -e "$t/out2/fake" ] || fail "size limit"
printf 'fake | 3.0 | file://%s | %s | ../etc\n' "$t/a.tar.gz" "$sha" > "$t/list"
[ "$(run)" = 1 ] && grep -q "bad path" "$t/log" || fail "path"
echo "ok: hs-docs-fetch"
