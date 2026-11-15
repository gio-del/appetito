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

# explicit map (issue 589): a test that does not name the file runs through device/edge/check-map
printf '#!/bin/sh\nexit 1\n' > "$t/device/edge/tests/mapped.sh"
printf '# c\ndevice/edge/debian/free-*  mapped.sh\n' > "$t/device/edge/check-map"
sh device/edge/check --changed device/edge/debian/free-tool > "$t/out" 2>&1; rc=$?
check "map: pattern match runs the mapped test" "$rc" 1
grep -q 'FAIL test device/edge/tests/mapped.sh' "$t/out"; check "map: mapped test reported" "$?" 0
sh device/edge/check --changed device/edge/tracker/issues.js > "$t/out" 2>&1; rc=$?
check "map: non-matching file does not run it" "$rc" 0

# every test named in the real map exists, and the real map covers the prompt and the tracker
cd "$R"
# the public Appetito copy has no check-map (it names private tests, issue 600): nothing to check there
[ -f device/edge/check-map ] || exit $fail
for x in $(grep -v '^#' device/edge/check-map | cut -d' ' -f2-); do [ -f "device/edge/tests/$x" ] || { echo "FAIL check-map: test $x missing"; fail=1; }; done
grep -q '^device/edge/debian/ops-auto\* .*ops-auto-guard.sh .*ops-auto-project.sh' device/edge/check-map; check "real map: prompt -> guard and project tests" "$?" 0
grep -q '^device/edge/tracker/\* .*settings-schema.sh .*tracker-queue-config.sh' device/edge/check-map; check "real map: tracker -> settings and queue tests" "$?" 0

exit $fail
