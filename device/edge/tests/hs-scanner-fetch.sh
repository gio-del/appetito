#!/bin/sh
# Test of hs-scanner-fetch (issue 529) on a fake local archive: right sha256 installs only the gitleaks file,
# read-only; a wrong sha256 or an archive without it installs nothing and keeps the previous copy; a second
# run is a no-op.
# From the repo root: device/edge/tests/hs-scanner-fetch.sh
set -eu
F=$PWD/device/edge/debian/hs-scanner-fetch
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: hs-scanner-fetch: $*"; cat "$t/log" 2> /dev/null; exit 1; }
mk() { # mk NAME [empty]
	mkdir -p "$t/src-$1"; echo "#!/bin/sh" > "$t/src-$1/gitleaks"; echo "other" > "$t/src-$1/README.md"
	[ "${2:-}" = empty ] && rm "$t/src-$1/gitleaks"
	tar -czf "$t/$1.tar.gz" -C "$t/src-$1" README.md $([ "${2:-}" = empty ] || echo gitleaks)
}
run() { HS_SCANNER_NOUSER=1 HS_SCANNER_DIR=$t/out HS_SCANNER_LOCAL=$t/none HS_SCANNER_URL=file://$t/$1.tar.gz HS_SCANNER_SHA256=$2 sh "$F" > "$t/log" 2>&1; }
mk good; sha=$(sha256sum "$t/good.tar.gz" | cut -d' ' -f1)
run good 0000000000000000000000000000000000000000000000000000000000000000 && fail "installed with a wrong sha256"
[ ! -e "$t/out/gitleaks" ] || fail "something installed after a wrong sha256"
run good "$sha" || fail "exit with the right sha256"
[ -x "$t/out/gitleaks" ] || fail "gitleaks missing"
[ ! -e "$t/out/README.md" ] || fail "other files installed"
[ -z "$(find "$t/out" -perm /022)" ] || fail "writable by group or others"
run good "$sha" || fail "second run"; [ ! -s "$t/log" ] || fail "second run is not a no-op"
mk empty empty; run empty "$(sha256sum "$t/empty.tar.gz" | cut -d' ' -f1)" && fail "installed an archive without gitleaks"
[ -x "$t/out/gitleaks" ] || fail "previous copy not kept"
echo "ok: hs-scanner-fetch"
