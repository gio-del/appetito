#!/bin/sh
# Test of `device/edge/check --changed` (issue 355): runs only the tests that name a changed file,
# fails when one of them fails. Uses a throwaway copy of the layout, never the real repo.
# From the repo root: device/edge/tests/check-changed.sh
set -u
R=$(pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }

mkdir -p "$t/device/edge/tests" "$t/device/edge/tracker" "$t/device/edge/debian"
cp "$R/device/edge/check" "$t/device/edge/check"
echo 'console.log("[]")' > "$t/device/edge/tracker/issues.js"
echo x > "$t/DIREZIONE.md"
printf '#!/bin/sh\necho hi\n' > "$t/device/edge/debian/broken-tool"
printf '#!/bin/sh\necho hi\n' > "$t/device/edge/debian/free-tool"
printf '#!/bin/sh\n# uses broken-tool\nexit 1\n' > "$t/device/edge/tests/uses-broken.sh"
printf '#!/bin/sh\n# uses other-tool\ntouch "$(dirname "$0")/ran-other"\n' > "$t/device/edge/tests/uses-other.sh"
cd "$t" && git init -q . && git add -A >/dev/null 2>&1

sh device/edge/check --changed device/edge/debian/broken-tool > "$t/out" 2>&1; rc=$?
check "file named by a broken test blocks" "$rc" 1
grep -q 'FAIL test device/edge/tests/uses-broken.sh' "$t/out"; check "failing test is reported" "$?" 0
[ ! -e device/edge/tests/ran-other ]; check "unrelated test not run" "$?" 0

sh device/edge/check --changed device/edge/debian/free-tool > "$t/out" 2>&1; rc=$?
check "file named by no test passes" "$rc" 0

git add -A >/dev/null 2>&1
sh device/edge/check --changed > "$t/out" 2>&1; rc=$?
check "no args: staged files are used" "$rc" 1

exit $fail
