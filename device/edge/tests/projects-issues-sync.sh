#!/bin/sh
# Test of projects-issues-sync (issue 091) with a stubbed curl and Gateway list: ids and fields,
# pull requests skipped, trust (owner author / self-assigned by the owner / assigned by someone
# else = untrusted), no body kept, token never on a command line, and a failed fetch keeps the old
# issues marked stale.
# From the repo root: device/edge/tests/projects-issues-sync.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin" "$t/home/.secrets"
echo SECRETTOKEN > "$t/home/.secrets/git-github"
sed "s#/var/lib/edge-status/projects-issues.json#$t/out.json#" "$R/device/edge/debian/projects-issues-sync" > "$t/bin/pis"
printf '#!/bin/sh\necho "sumi https://github.com/me/sumi.git sumi active - -"\necho "local - - - active issues -"\n' > "$t/bin/gateway-projects"
cat > "$t/bin/curl" <<'EOS'
#!/bin/sh
cat > "$CURL_STDIN"
echo "$*" >> "$CURL_ARGS"
[ -e "$CURL_FAIL" ] && exit 22
case "$*" in
*/issues/3/timeline*) echo '[{"event":"assigned","assignee":{"login":"me"},"actor":{"login":"stranger"}}]' ;;
*/issues/4/timeline*) echo '[{"event":"assigned","assignee":{"login":"me"},"actor":{"login":"me"}}]' ;;
*/issues*) cat <<'J'
[{"number":1,"title":"mine","state":"open","html_url":"u1","user":{"login":"me"},"labels":[{"name":"bug"}],"assignees":[],"body":"SECRETBODY","created_at":"a","updated_at":"b"},
 {"number":2,"title":"pr","state":"open","html_url":"u2","user":{"login":"me"},"pull_request":{},"labels":[],"assignees":[]},
 {"number":3,"title":"assigned by stranger","state":"open","html_url":"u3","user":{"login":"x"},"labels":[],"assignees":[{"login":"me"}]},
 {"number":4,"title":"self assigned","state":"closed","html_url":"u4","user":{"login":"x"},"labels":[],"assignees":[{"login":"me"}]},
 {"number":5,"title":"foreign","state":"open","html_url":"u5","user":{"login":"x"},"labels":[],"assignees":[]}]
J
;;
esac
EOS
chmod +x "$t/bin/pis" "$t/bin/curl" "$t/bin/gateway-projects"
export CURL_STDIN=$t/stdin CURL_ARGS=$t/args CURL_FAIL=$t/fail
run() { HOME=$t/home PATH=$t/bin:$PATH sh "$t/bin/pis"; }
fail() { echo "FAIL: $1"; cat "$t/out.json" 2>/dev/null; exit 1; }
run
q() { jq -r "$1" "$t/out.json"; }
[ "$(q '.projects | keys | join(",")')" = sumi ] || fail "only the GitHub Project is mirrored"
[ "$(q '.projects.sumi.issues | map(.number) | join(",")')" = 1,3,4,5 ] || fail "numbers (PR must be skipped)"
[ "$(q '.projects.sumi.issues | map(.trust // "-") | join(",")')" = author,-,self-assigned,- ] || fail "trust"
[ "$(q '.projects.sumi.issues[0].labels[0]')" = bug ] || fail "labels"
grep -q SECRETBODY "$t/out.json" && fail "issue body kept"
grep -q SECRETTOKEN "$t/args" && fail "token on a command line"
grep -q SECRETTOKEN "$t/stdin" || fail "token not given to curl on stdin"
[ "$(q '.projects.sumi.stale')" = false ] || fail "stale on success"
touch "$t/fail"; run
[ "$(q '.projects.sumi.stale')" = true ] || fail "failed fetch not marked stale"
[ "$(q '.projects.sumi.issues | length')" = 4 ] || fail "failed fetch lost the old issues"
echo "projects-issues-sync: ok"
