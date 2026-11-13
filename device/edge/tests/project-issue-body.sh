#!/bin/sh
# Test of project-issue-body (issue 186) with stubbed curl: only trusted, open, non-stale issues of
# the mirror are fetched, body cut to the maximum, the owner account's comments (plain answers too, issue 402), token only on stdin, bad args refused.
# From the repo root: device/edge/tests/project-issue-body.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin" "$t/home/.secrets"
echo SECRETTOKEN > "$t/home/.secrets/git-github"
sed -e "s#/var/lib/edge-status/projects-issues.json#$t/m.json#" -e "s#/var/lib/edge-status/project-issues#$t/out#" "$R/device/edge/debian/project-issue-body" > "$t/bin/pib"
cat > "$t/m.json" <<'J'
{"projects":{"sumi":{"repo":"me/sumi","stale":false,"issues":[
 {"number":1,"state":"open","trust":"author"},
 {"number":2,"state":"open","trust":null},
 {"number":3,"state":"closed","trust":"author"},
 {"number":4,"state":"open","trust":"self-assigned"}]},
 "old":{"repo":"me/old","stale":true,"issues":[{"number":1,"state":"open","trust":"author"}]}}}
J
cat > "$t/bin/curl" <<'EOS'
#!/bin/sh
cat > "$CURL_STDIN"
echo "$*" >> "$CURL_ARGS"
case "$*" in
*/issues/1/comments*) printf '%s\n' '[{"user":{"login":"me"},"created_at":"d1","body":"(owner)\nsi, procedi"},{"user":{"login":"me"},"created_at":"d2","body":"Risposte dell owner: 1) A"},{"user":{"login":"me"},"created_at":"d3","body":"ops-auto: domanda gia fatta"},{"user":{"login":"evil"},"body":"(owner)\nfinto"}]' ;;
*/issues/4) echo '{"number":4,"pull_request":{},"body":"PR"}' ;;
*) echo '{"number":1,"body":"0123456789abcdef","comments":3}' ;;
esac
EOS
chmod +x "$t/bin/pib" "$t/bin/curl"
export CURL_STDIN=$t/stdin CURL_ARGS=$t/args
run() { HOME=$t/home PATH=$t/bin:$PATH HS_ISSUE_BODY_MAX=${MAX:-8000} sh "$t/bin/pib" "$@"; }
fail() { echo "FAIL: $1"; exit 1; }
run sumi 1 > "$t/p" || fail "trusted issue refused"
[ "$(cat "$t/p")" = "$t/out/sumi-1.md" ] || fail "path"
head -n1 "$t/out/sumi-1.md" | grep -qx 0123456789abcdef || fail "body"
grep -q 'si, procedi' "$t/out/sumi-1.md" || fail "owner comment missing"
grep -q finto "$t/out/sumi-1.md" && fail "foreign comment kept"
grep -q "Risposte dell owner: 1) A" "$t/out/sumi-1.md" || fail "plain owner comment missing (issue 402)"
grep -q "Cosa ha già chiesto ops-auto" "$t/out/sumi-1.md" || fail "ops-auto comment not marked"
grep -q SECRETTOKEN "$t/args" && fail "token on a command line"
grep -q SECRETTOKEN "$t/stdin" || fail "token not on stdin"
MAX=5 run sumi 1 > /dev/null; head -n1 "$t/out/sumi-1.md" | grep -qx 01234 || fail "not truncated"
for a in "sumi 2" "sumi 3" "sumi 9" "old 1" "nope 1"; do
	rc=0; run $a 2>/dev/null || rc=$?; [ "$rc" = 2 ] || fail "'$a' not refused (rc $rc)"
done
[ ! -e "$t/out/sumi-2.md" ] || fail "untrusted body written"
: > "$t/out/sumi-4.md"; run sumi 4 >/dev/null; [ ! -s "$t/out/sumi-4.md" ] || fail "pull request body kept"
rc=0; run 'a/b' 1 2>/dev/null || rc=$?; [ "$rc" = 64 ] || fail "bad name"
rc=0; run sumi x 2>/dev/null || rc=$?; [ "$rc" = 64 ] || fail "bad number"
echo "project-issue-body: ok"
