#!/bin/sh
# Test of issues-context (issue 118): linked issues (Parent, Related, children) with state, cited files
# (repo paths, ~/bin names, backticked script names) with line count, tests and docs lines naming them,
# the function index of big files, the 8 KB cap, and proposals never read. Temp repo only.
# From the repo root: device/edge/tests/issues-context.sh
set -eu
C=$(pwd)/device/edge/tracker/context.js
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
mkdir -p "$t/issues/open" "$t/issues/done" "$t/issues/proposed" "$t/device/edge/debian" "$t/device/edge/tests" "$t/docs"
printf '# Epic\n\nOpened: 2026-10-01\nStatus: todo\n\nEpic text.\n' > "$t/issues/open/010-epic.md"
printf '# Old one\n\nOpened: 2026-10-01\nClosed: 2026-10-02\n\n## Fatto (2026-10-02)\nMarker done section.\n' > "$t/issues/done/011-old.md"
printf '# Secret proposal\n\nStatus: todo\n\nPROPOSAL-TEXT\n' > "$t/issues/proposed/013-prop.md"
printf '# Sibling\n\nOpened: 2026-10-01\nStatus: todo\nParent: 012\n\nChild text.\n' > "$t/issues/open/014-child.md"
printf '# Work\n\nOpened: 2026-10-01\nBlocked on: -\nStatus: todo\nParent: 010\nRelated: 011, 013\n\nFix `alpha` and ~/bin/beta, see device/edge/deploy.\n' > "$t/issues/open/012-work.md"
{ echo '#!/bin/sh'; i=0; while [ $i -lt 200 ]; do echo "f$i() { :; }"; i=$((i + 1)); done; } > "$t/device/edge/debian/alpha"
printf '#!/bin/sh\necho beta\n' > "$t/device/edge/debian/beta"
printf '#!/bin/sh\n' > "$t/device/edge/deploy"
printf '#!/bin/sh\nalpha --x\n' > "$t/device/edge/tests/alpha.sh"
printf '# Doc\n\n## Section A\n\nUse `beta` here.\n' > "$t/docs/area.md"
git -C "$t" init -q; git -C "$t" add -A; git -C "$t" -c user.name=t -c user.email=t@t commit -qm 'first commit'
out=$(node "$C" 012 "$t")
echo "$out" | grep -q 'Parent 010 \[todo\] Epic' || fail "parent"
echo "$out" | grep -q 'Related 011 \[done\] Old one' || fail "related done"
echo "$out" | grep -q 'Marker done section' || fail "last progress"
echo "$out" | grep -q 'Child 014 \[todo\] Sibling' || fail "child"
echo "$out" | grep -q 'Related 013: non in open/ o done/' || fail "proposal should be named only"
echo "$out" | grep -q 'PROPOSAL-TEXT\|Secret proposal' && fail "proposal text read"
echo "$out" | grep -q '^- device/edge/debian/alpha (201 righe)' || fail "alpha lines"
echo "$out" | grep -q 'test: device/edge/tests/alpha.sh' || fail "alpha test"
echo "$out" | grep -q 'commit: [0-9a-f]* first commit' || fail "commits"
echo "$out" | grep -q '^- device/edge/debian/beta' || fail "~/bin path"
echo "$out" | grep -q '^- device/edge/deploy' || fail "repo path"
echo "$out" | grep -q 'docs/area.md «Section A»: righe 5' || fail "docs line"
echo "$out" | grep -q 'alpha: f0@2 f1@3' || fail "function index"
[ "$(node "$C" 012 "$t" | wc -c)" -le 8192 ] || fail "size"
small=$(node -e 'console.log(require(process.argv[1]).context(process.argv[2], "012", 600))' "$C" "$t")
[ "$(printf '%s' "$small" | wc -c)" -le 600 ] || fail "cap"
echo "$small" | grep -q 'Funzioni' && fail "function index kept over the cap"
node "$C" 099 "$t" 2>/dev/null && fail "missing issue should fail"
# Local docs (issue 125): an app the issue names gets its path, others not.
mkdir -p "$t/hsdocs/caddy/2.6.2" "$t/hsdocs/adguardhome/0.1" "$t/hsdocs/radicale/3.5"
printf '# Proxy\n\nOpened: 2026-10-01\nStatus: todo\n\nCaddy and AdGuard Home config.\n' > "$t/issues/open/015-proxy.md"
d=$(HS_DOCS_DIR=$t/hsdocs node "$C" 015 "$t")
echo "$d" | grep -q "caddy 2.6.2: .grep -rn PATTERN $t/hsdocs/caddy/2.6.2" && echo "$d" | grep -q "adguardhome 0.1" || fail "local docs"
echo "$d" | grep -q radicale && fail "unnamed app listed"
echo "ok: issues-context"
