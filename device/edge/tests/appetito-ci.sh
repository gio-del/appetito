#!/bin/sh
# Test of `appetito-publish --ci` / `--ci-check` (issue 570): reads the outcome of the clean-install run from GitHub
# Actions. A stub `curl` plays the API: green, pending, none, red. Only --ci-check exits 1 on red.
# From the repo root: device/edge/tests/appetito-ci.sh
set -eu
root=$(pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
mkdir "$t/bin"
cat > "$t/bin/curl" << 'E'
#!/bin/sh
# last argument is the URL
for a; do u=$a; done
case $u in
*/workflows/install.yml/runs*) cat "$STUB/runs.json" ;;
*/actions/runs/*/jobs*) cat "$STUB/jobs.json" ;;
*/logs) echo "boom: Process completed with exit code 1" ;;
*) exit 22 ;;
esac
E
chmod +x "$t/bin/curl"
printf 'tok\n' > "$t/token"
printf 'HS_APPETITO_REPO=someone/appetito\n' > "$t/env"
export STUB="$t" PATH="$t/bin:$PATH" HS_GIT_TOKEN="$t/token" HS_ENV_FILE="$t/env" HS_PROJECTS_FILE=/dev/null
run() { sh "$root/scripts/appetito-publish" "$@"; }

echo '{"workflow_runs":[{"id":1,"head_sha":"abcdef1234","status":"completed","conclusion":"success","event":"push","name":"install"}]}' > "$t/runs.json"
out=$(run --ci-check) || fail "green must exit 0"
echo "$out" | grep -q 'abcdef1 green' || fail "green line: $out"
echo "$out" | grep -q 'installazione pulita ok al commit abcdef1' || fail "green summary: $out"

echo '{"workflow_runs":[{"id":1,"head_sha":"abcdef1234","status":"in_progress","conclusion":null,"event":"push","name":"install"}]}' > "$t/runs.json"
out=$(run --ci-check) || fail "pending must exit 0"
echo "$out" | grep -q 'abcdef1 pending' || fail "pending: $out"

echo '{"workflow_runs":[]}' > "$t/runs.json"
[ "$(run --ci-check)" = none ] || fail "none"

echo '{"workflow_runs":[{"id":7,"head_sha":"abcdef1234","status":"completed","conclusion":"failure","event":"push","name":"install"}]}' > "$t/runs.json"
echo '{"jobs":[{"id":9,"name":"install on x","conclusion":"failure","steps":[{"name":"Checks","conclusion":"failure"}]}]}' > "$t/jobs.json"
run --ci > "$t/o" || fail "--ci on red must exit 0 (read only)"
grep -q 'abcdef1 red' "$t/o" || fail "red line"
grep -q 'Checks' "$t/o" || fail "failed step missing"
if run --ci-check > "$t/o"; then fail "--ci-check on red must exit 1"; fi
grep -q 'installazione pulita rotta al commit abcdef1' "$t/o" || fail "red summary"
echo "ok"
