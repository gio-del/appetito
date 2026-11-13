#!/bin/sh
# Test of projects-issue-apply (issue 184) with stubbed curl/gateway-projects: validates the request
# (id, age, Project, action, label), re-reads the issue before writing, refuses PRs and no-op changes,
# token only on stdin. From the repo root: device/edge/tests/projects-issue-apply.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin" "$t/home/.secrets" "$t/home/bin" "$t/w"
echo SECRETTOKEN > "$t/home/.secrets/git-github"
printf '#!/bin/sh\necho synced >> "%s/synced"\n' "$t" > "$t/home/bin/projects-issues-sync"
cat > "$t/m.json" <<'J'
{"projects":{"sumi":{"issues":[{"number":5,"trust":"author"},{"number":6,"trust":null},{"number":9,"trust":"author"},{"number":10,"trust":"author"}]}}}
J
cp "$R/device/edge/debian/projects-issue-apply" "$t/bin/pia"
printf '#!/bin/sh\necho "sumi https://github.com/me/sumi.git sumi active - -"\necho "other https://gitlab.com/me/o.git - active - -"\n' > "$t/bin/gateway-projects"
cat > "$t/bin/curl" <<'EOS'
#!/bin/sh
cat >> "$CURL_STDIN"
echo "$*" >> "$CURL_ARGS"
case "$*" in
*/issues/5/comments*|*/issues/5/labels*|*"-X PATCH"*) echo '{}' ;;
*/issues/404*) exit 22 ;;
*/issues/9/comments*) echo '[{"user":{"login":"bot"},"body":"serve il tuo ok"}]' ;;
*/issues/10/comments*) echo '{}' ;;
*/issues/9) printf '%s\n' '{"state":"open","labels":[{"name":"needs-owner"}],"body":"- [ ] (HITL) scegli A o B (x)\n- [ ] (HITL) conferma il deploy\n- [x] (HITL) fatto"}' ;;
*/issues/10) echo '{"state":"open","labels":[{"name":"needs-owner"}],"body":"niente passi"}' ;;
*/issues/10/labels/needs-owner*) echo '{}' ;;
*/issues/8) echo '{"state":"open","labels":[],"pull_request":{}}' ;;
*/issues/6) echo '{"state":"closed","labels":[{"name":"bug"}]}' ;;
*/issues/5) echo '{"state":"open","labels":[{"name":"bug"}]}' ;;
esac
EOS
chmod +x "$t/bin/"* "$t/home/bin/"*
export HS_MIRROR=$t/m.json CURL_STDIN=$t/stdin CURL_ARGS=$t/args HS_WRITES_DIR=$t/w
: > "$t/stdin"; : > "$t/args"
fail() { echo "FAIL: $1"; exit 1; }
req() { # id json-fields  (at defaults to now)
	jq -n --arg id "$1" --argjson at "${AT:-$(date +%s)}" "{id:\$id, at:\$at} + $2" > "$t/w/$1.req.json"
}
res() { jq -r "$2" "$t/w/$1.res.json"; }
run() { HOME=$t/home PATH=$t/bin:$PATH sh "$t/bin/pia" > /dev/null; }

req aaaaaaaaaaaaaaa1 '{project:"sumi", number:5, action:"comment", text:"ciao"}'
req aaaaaaaaaaaaaaa2 '{project:"sumi", number:5, action:"close"}'
req aaaaaaaaaaaaaaa3 '{project:"sumi", number:6, action:"close"}'
req aaaaaaaaaaaaaaa4 '{project:"sumi", number:6, action:"reopen"}'
req aaaaaaaaaaaaaaa5 '{project:"sumi", number:5, action:"label-add", label:"help wanted"}'
req aaaaaaaaaaaaaaa6 '{project:"sumi", number:5, action:"label-add", label:"bug"}'
req aaaaaaaaaaaaaaa7 '{project:"sumi", number:5, action:"label-remove", label:"bug"}'
req aaaaaaaaaaaaaaa8 '{project:"sumi", number:5, action:"label-add", label:"x\"y"}'
req aaaaaaaaaaaaaaa9 '{project:"other", number:5, action:"close"}'
req aaaaaaaaaaaaaaab '{project:"nope", number:5, action:"close"}'
req aaaaaaaaaaaaaaac '{project:"sumi", number:8, action:"comment", text:"x"}'
req aaaaaaaaaaaaaaad '{project:"sumi", number:404, action:"close"}'
req aaaaaaaaaaaaaaae '{project:"sumi", number:5, action:"delete"}'
req aaaaaaaaaaaaaaaf '{project:"sumi", number:5, action:"comment", text:""}'
req dddddddddddddd01 '{project:"sumi", number:9, action:"read"}'
req dddddddddddddd02 '{project:"sumi", number:6, action:"read"}'
req dddddddddddddd03 '{project:"sumi", number:9, action:"answer", answers:[{text:"(HITL) conferma il deploy", kind:"answer", note:"ok"}]}'
req dddddddddddddd04 '{project:"sumi", number:9, action:"answer", answers:[{text:"(HITL) scegli A o B (x)", kind:"answer", note:"A"},{text:"(HITL) conferma il deploy", kind:"done", note:""}]}'
req dddddddddddddd05 '{project:"sumi", number:9, action:"answer", answers:[{text:"(HITL) inventato", kind:"answer", note:"A"}]}'
req dddddddddddddd06 '{project:"sumi", number:6, action:"answer", answers:[{text:"", kind:"answer", note:"A"}]}'
req dddddddddddddd07 '{project:"sumi", number:10, action:"answer", answers:[{text:"", kind:"answer", note:"vai"}]}'
req dddddddddddddd08 '{project:"sumi", number:9, action:"answer", answers:[{text:"(HITL) scegli A o B (x)", kind:"answer", note:""}]}'
AT=1000 req bbbbbbbbbbbbbbb1 '{project:"sumi", number:5, action:"close"}'
echo '{"id":"../../etc","at":1}' > "$t/w/cccccccccccccccc.req.json"
run
[ "$(res aaaaaaaaaaaaaaa1 .ok)" = true ] || fail "comment"
grep -q 'issues/5/comments' "$t/args" || fail "comment not posted"
[ "$(res aaaaaaaaaaaaaaa2 .ok)" = true ] || fail "close"
[ "$(res aaaaaaaaaaaaaaa3 .ok)" = false ] || fail "close of a closed issue accepted"
[ "$(res aaaaaaaaaaaaaaa4 .ok)" = true ] || fail "reopen"
[ "$(res aaaaaaaaaaaaaaa5 .ok)" = true ] || fail "label add"
[ "$(res aaaaaaaaaaaaaaa6 .ok)" = false ] || fail "label already there accepted"
[ "$(res aaaaaaaaaaaaaaa7 .ok)" = true ] || fail "label remove"
grep -q 'labels/bug' "$t/args" || fail "label not deleted"
[ "$(res aaaaaaaaaaaaaaa8 .ok)" = false ] || fail "odd label accepted"
[ "$(res aaaaaaaaaaaaaaa9 .ok)" = false ] || fail "non-GitHub Project accepted"
[ "$(res aaaaaaaaaaaaaaab .ok)" = false ] || fail "unknown Project accepted"
[ "$(res aaaaaaaaaaaaaaac .ok)" = false ] || fail "PR accepted"
[ "$(res aaaaaaaaaaaaaaad .ok)" = false ] || fail "missing issue accepted"
[ "$(res aaaaaaaaaaaaaaae .ok)" = false ] || fail "odd action accepted"
[ "$(res aaaaaaaaaaaaaaaf .ok)" = false ] || fail "empty comment accepted"
[ "$(res bbbbbbbbbbbbbbb1 .ok)" = false ] || fail "stale request accepted"
[ ! -e "$t/w/cccccccccccccccc.res.json" ] || fail "request with odd id answered"
[ "$(res dddddddddddddd01 .ok)" = true ] || fail "read"
[ "$(res dddddddddddddd01 '.steps|length')" = 2 ] || fail "read: open steps only"
[ "$(res dddddddddddddd01 .last.text)" = "serve il tuo ok" ] || fail "read: last comment"
[ "$(res dddddddddddddd01 .needs_owner)" = true ] || fail "read: needs_owner"
[ "$(res dddddddddddddd02 .ok)" = false ] || fail "read of an untrusted issue accepted"
[ "$(res dddddddddddddd03 .ok)" = true ] || fail "answer 2nd step"
[ "$(res dddddddddddddd04 .ok)" = true ] || fail "answer first step"
[ "$(res dddddddddddddd05 .ok)" = false ] || fail "answer to an unknown step accepted"
[ "$(res dddddddddddddd06 .ok)" = false ] || fail "answer on an untrusted issue accepted"
[ "$(res dddddddddddddd07 .ok)" = true ] || fail "answer without steps"
[ "$(res dddddddddddddd08 .ok)" = false ] || fail "empty answer accepted"
res dddddddddddddd03 .msg | grep -q 'manca il primo' || fail "label removed although first step not answered"
res dddddddddddddd04 .msg | grep -q 'torna in coda' || fail "no unblock after the first step"
res dddddddddddddd07 .msg | grep -q 'torna in coda' || fail "no unblock without steps"
grep -c 'DELETE.*labels/needs-owner' "$t/args" | grep -qx 2 || fail "needs-owner removals (want 2: issues 9 and 10)"
grep -q '(owner)' "$t/args" || fail "comment lacks (owner)"
grep -q SECRETTOKEN "$t/args" && fail "token on a command line"
grep -q SECRETTOKEN "$t/stdin" || fail "token not on stdin"
grep -q 'PATCH.*state.*closed' "$t/args" || grep -q '"state":"closed"' "$t/args" || fail "close body"
[ -s "$t/synced" ] || fail "mirror not refreshed"
# Two instances (service + cron, issue 332): while another holds the lock nothing is applied; after, it is.
req eeeeeeeeeeeeee01 '{project:"sumi", number:5, action:"comment", text:"lock"}'
: > "$t/args"
( flock 9; run; [ ! -e "$t/w/eeeeeeeeeeeeee01.res.json" ] ) 9> "$t/w/.lock" || fail "applied while another instance holds the lock"
run
[ "$(res eeeeeeeeeeeeee01 .ok)" = true ] || fail "request not answered once the lock was free"
grep -c 'issues/5/comments' "$t/args" | grep -qx 1 || fail "request applied twice"
sh -n device/edge/debian/sv/projects-issue-apply/run || fail "service run syntax"
# A second run changes nothing (answers are kept).
: > "$t/args"; run
[ ! -s "$t/args" ] || fail "answered requests handled again"
echo "projects-issue-apply: ok"
