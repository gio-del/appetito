#!/bin/sh
# Test of hs-skill-fetch (issue 499) on a fake local archive: right sha256 installs only the skill folder
# without scripts/tests, read-only; a wrong sha256, an archive without the skill or one with a symlink
# installs nothing and keeps the previous copy; a second run is a no-op.
# From the repo root: device/edge/tests/hs-skill-fetch.sh
set -eu
F=$PWD/device/edge/debian/hs-skill-fetch
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: hs-skill-fetch: $*"; cat "$t/log" 2> /dev/null; exit 1; }
mk() { # mk NAME [extra]: archive NAME.tar.gz with one top folder, like a GitHub archive
	r=$t/src-$1/repo-abc; mkdir -p "$r/.claude/skills/ui-ux-pro-max/scripts/tests" "$r/.claude/skills/ui-ux-pro-max/data" "$r/.claude/skills/other" "$r/cli"
	echo "# skill" > "$r/.claude/skills/ui-ux-pro-max/SKILL.md"; echo "print(1)" > "$r/.claude/skills/ui-ux-pro-max/scripts/search.py"
	echo "t" > "$r/.claude/skills/ui-ux-pro-max/scripts/tests/t.py"; echo "a,b" > "$r/.claude/skills/ui-ux-pro-max/data/x.csv"
	echo "no" > "$r/.claude/skills/other/SKILL.md"; echo "no" > "$r/cli/run.sh"
	case ${2:-} in link) ln -s /etc/passwd "$r/.claude/skills/ui-ux-pro-max/data/l" ;; empty) rm "$r/.claude/skills/ui-ux-pro-max/SKILL.md" ;; esac
	tar -czf "$t/$1.tar.gz" -C "$t/src-$1" repo-abc
}
run() { HS_SKILL_NOUSER=1 HS_SKILLS_DIR=$t/out HS_SKILL_URL=file://$t/$1.tar.gz HS_SKILL_SHA256=$2 sh "$F" > "$t/log" 2>&1; }
D=$t/out/ui-ux-pro-max
mk good; sha=$(sha256sum "$t/good.tar.gz" | cut -d' ' -f1)
run good 0000000000000000000000000000000000000000000000000000000000000000 && fail "installed with a wrong sha256"
[ ! -e "$D" ] || fail "something installed after a wrong sha256"
run good "$sha" || fail "exit with the right sha256"
[ -f "$D/SKILL.md" ] && [ -f "$D/scripts/search.py" ] && [ -f "$D/data/x.csv" ] || fail "skill files missing"
[ ! -e "$D/scripts/tests" ] || fail "scripts/tests installed"
[ ! -e "$t/out/other" ] && [ -z "$(find "$t/out" -name run.sh)" ] || fail "files outside the skill installed"
[ -z "$(find "$D" -perm /022)" ] || fail "writable by group or others"
run good "$sha" || fail "second run"; [ ! -s "$t/log" ] || fail "second run is not a no-op"
mk link link; run link "$(sha256sum "$t/link.tar.gz" | cut -d' ' -f1)" && fail "installed an archive with a symlink"
mk empty empty; run empty "$(sha256sum "$t/empty.tar.gz" | cut -d' ' -f1)" && fail "installed an archive without SKILL.md"
[ -f "$D/SKILL.md" ] && [ ! -e "$D/data/l" ] || fail "previous copy not kept"
echo "ok: hs-skill-fetch"
