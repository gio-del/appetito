#!/bin/sh
# Test of projects-publish (issue 163) with stubbed curl/git/gateway-projects: refuses unknown
# Projects, non-GitHub URLs and branches other than issue/<id>; opens the PR; auto-merge only
# when no sensitive file is touched; token never on a command line; creates issues.
# From the repo root: device/edge/tests/projects-publish.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin" "$t/home/.secrets" "$t/home/projects/sumi"
echo SECRETTOKEN > "$t/home/.secrets/git-github"
cp "$R/device/edge/debian/projects-publish" "$t/bin/pp"
cp "$R/device/edge/debian/hs-attribution" "$t/bin/hs-attribution"
# secrets scan (issue 529): a stub that refuses a text with a token-looking word, the real one has its own test (hs-secrets.sh)
printf '#!/bin/sh\nif cat "${2:-/dev/stdin}" | grep -q ghp_; then echo "segreto (stub): testo:1"; exit 1; fi\n' > "$t/bin/hs-secrets"
printf '#!/bin/sh\necho "sumi https://github.com/me/sumi.git sumi active - -"\necho "other https://gitlab.com/me/o.git - active - -"\n' > "$t/bin/gateway-projects"
cat > "$t/bin/git" <<'EOS'
#!/bin/sh
echo "$*" >> "$GIT_LOG"
case "$*" in *"show refs/heads/"*"pr-title.yml"*) [ -n "${TITLE_YML:-}" ] || exit 128; printf '%s\n' "$TITLE_YML"; exit 0 ;; esac
case "$*" in *%an*) printf '%s\n' "${AUTHORS:-me <me@x.it>}"; exit 0 ;; *"log --format=%B"*) printf '%s\n' "${MSGS:-fix the bug}"; exit 0 ;; *" diff "*) printf '%s\n' "${DIFF:-+ok}"; exit 0 ;; esac
case "$*" in *rev-parse*issue/exists*|*rev-parse*issue/dep*|*rev-parse*issue/215-new*) exit 0 ;; *rev-parse*) exit 1 ;; esac
exit 0
EOS
cat > "$t/bin/curl" <<'EOS'
#!/bin/sh
cat > "$CURL_STDIN"
echo "$*" >> "$CURL_ARGS"
case "$*" in
*/rules/branches/main*) printf '%s
' "${RULES:-[]}" ;;
*matching-refs*) printf '%s
' "${REFS:-[]}" ;;
*"pulls?head=me:"*"state=open"*) printf '%s
' "${OPEN_PR:-[]}" ;;
*"pulls?head=me:"*"state=all"*) printf '%s
' "${ALL_PR:-[]}" ;;
*/actions/runs/*/jobs*) printf '%s
' "$JOBS" ;;
*/actions/runs?head_sha*) printf '%s
' "$AREPLY" ;;
*/commits/*/check-runs*) [ -z "${NOCHECKS:-}" ] || exit 22; printf '%s
' "$RUNS" ;;
*/check-runs/*/annotations*) echo '[{"annotation_level":"failure","path":"backend/client.go","start_line":93,"message":"Error return value of os.RemoveAll is not checked (errcheck)"}]' ;;
*"pulls?state=open&per_page=50"*) printf '%s\n' "${REL_PRS:-[]}" ;;
*/releases/latest*) echo '{"tag_name":"v0.4.0","published_at":"2026-09-22T00:00:00Z"}' ;;
*/pulls/7/update-branch*) echo "${UB_RES:-{\"message\":\"ok\"}}" ;;
*/pulls/7/merge*) echo "${MERGE_RES:-{\"merged\":true}}" ;;
*/pulls/7) printf '%s\n' "$PR7" ;;
*/commits/*) echo '{"parents":[{"sha":"1111111111111111111111111111111111111111"}],"commit":{"committer":{"date":"2026-10-01T00:00:00Z"}}}' ;;
*/pulls/7/files*) printf '%s\n' "$FILES" | jq -Rc '{filename:.}' | jq -sc . ;;
*/pulls*) echo '{"number":7,"node_id":"N7","html_url":"https://github.com/me/sumi/pull/7"}' ;;
*graphql*) echo '{"data":{}}' ;;
*/repos/me/sumi) echo '{"permissions":{"push":true},"allow_squash_merge":true}' ;;
*/issues*) echo '{"number":9,"html_url":"https://github.com/me/sumi/issues/9"}' ;;
esac
EOS
chmod +x "$t/bin/"*
export HS_RULES_DIR=$t CURL_STDIN=$t/stdin CURL_ARGS=$t/args GIT_LOG=$t/gitlog
run() { HOME=$t/home PATH=$t/bin:$PATH sh "$t/bin/pp" "$@"; }
fail() { echo "FAIL: $1"; exit 1; }
run pr nope issue/exists T > /dev/null 2>&1 && fail "unknown Project accepted"
run pr other issue/exists T > /dev/null 2>&1 && fail "non-GitHub URL accepted"
run pr sumi main T > /dev/null 2>&1 && fail "main accepted"
run pr sumi issue/../x T > /dev/null 2>&1 && fail "odd branch accepted"
run pr sumi issue/missing T > /dev/null 2>&1 && fail "missing branch accepted"
: > "$t/args"
FILES='src/a.go' out=$(FILES='src/a.go' run pr sumi issue/exists "Titolo")
echo "$out" | grep -q '^PR 7 https' || fail "PR line"
echo "$out" | grep -q 'auto-merge: attivo' || fail "auto-merge should be on"
grep -q 'push -q https://github.com/me/sumi.git refs/heads/issue/exists:refs/heads/issue/exists' "$t/gitlog" || fail "push"
grep -q SECRETTOKEN "$t/args" "$t/gitlog" && fail "token on a command line"
grep -q SECRETTOKEN "$t/stdin" || fail "token not on stdin"
printf "token ghp_x\n" > "$t/sec.md"; FILES=src/a.go run pr sumi issue/exists "Titolo" "$t/sec.md" > "$t/o" 2>&1 && fail "PR body with a secret published"
grep -q "segreto" "$t/o" || fail "secret refusal not explained: $(cat "$t/o")"
out=$(FILES='.github/workflows/ci.yml' run pr sumi issue/dep T)
echo "$out" | grep -q 'auto-merge: no' || fail "auto-merge on for .github"
out=$(FILES='frontend/package.json' run pr sumi issue/dep T)
echo "$out" | grep -q 'auto-merge: no' || fail "auto-merge on for dependencies"
[ "$(run issue sumi "Titolo")" = "9 https://github.com/me/sumi/issues/9" ] || fail "issue"
# issue 202: no trace of Claude/AI
run pr sumi claude/exists T > /dev/null 2>&1 && fail "claude/ branch accepted"
for m in "x\n\nCo-Authored-By: Claude <noreply@anthropic.com>" "Claude-Session: abc" "see https://claude.ai/code/s" "Generated with Claude Code" "this is AI-generated" "written by Claude" "done 🤖" "_Preparata in automatico da ops-auto sul server (Claude Code)_"; do
	MSGS=$(printf "$m") run pr sumi issue/exists T > "$t/o" 2>&1 && fail "message accepted: $m"
	grep -q attribuzione "$t/o" || fail "no reason for: $m"
done
AUTHORS="Claude <c@x.it>" run pr sumi issue/exists T > /dev/null 2>&1 && fail "claude author accepted"
AUTHORS="me <noreply@anthropic.com>" run pr sumi issue/exists T > /dev/null 2>&1 && fail "anthropic email accepted"
DIFF="+// written by Claude" run pr sumi issue/exists T > /dev/null 2>&1 && fail "diff attribution accepted"
run pr sumi issue/exists "Generated with Claude Code" > /dev/null 2>&1 && fail "PR title accepted"
printf "Co-authored-by: Claude\n" > "$t/bad"
run pr sumi issue/exists T "$t/bad" > /dev/null 2>&1 && fail "PR body accepted"
run issue sumi "Made by AI" > /dev/null 2>&1 && fail "issue title accepted"
run issue sumi T "$t/bad" > /dev/null 2>&1 && fail "issue body accepted"
FILES=src/a.go MSGS="use the user's Claude for generation" DIFF="+// calls the user's Claude" run pr sumi issue/exists "Run generation on the user's Claude" > /dev/null 2>&1 || fail "domain use of Claude refused"
FILES=src/a.go MSGS="run via headless Claude Code" DIFF="+// spawns Claude Code" run pr sumi issue/exists "Run generation via headless Claude Code (#215)" > /dev/null 2>&1 || fail "Claude Code as subject refused"
run check sumi | grep -q "^ok" || fail "check"
# issue 282: "Fixes #N" added to the body when the branch carries the id and no keyword is there
: > "$t/args"; FILES=src/a.go run pr sumi issue/215-new T > /dev/null
grep -q 'Fixes #215' "$t/args" || fail "Fixes #N not added"
printf 'chiude #215\n' > "$t/b1"; : > "$t/args"; FILES=src/a.go run pr sumi issue/215-new T "$t/b1" > /dev/null
tr "\n" " " < "$t/args" | grep -q "chiude #215.*Fixes #215" || { cat "$t/args"; fail "Fixes #N not appended to the body"; }
printf 'Closes #215\n' > "$t/b2"; : > "$t/args"; FILES=src/a.go run pr sumi issue/215-new T "$t/b2" > /dev/null
grep -c 'Fixes #215' "$t/args" | grep -q '^0$' || fail "Fixes added despite Closes"
run issue sumi "Epic: x" 2>&1 | grep -q 'manca la label epic' || fail "no epic warning"
run issue sumi "Epic: x" "" epic 2>&1 | grep -q 'manca la label epic' && fail "epic warning despite label"
# issue 206: an open PR is updated by the push, not duplicated
: > "$t/args"
out=$(OPEN_PR='[{"number":5,"html_url":"https://github.com/me/sumi/pull/5"}]' run pr sumi issue/exists T)
[ "$(echo "$out" | head -n1)" = "PR 5 https://github.com/me/sumi/pull/5" ] || fail "existing PR not reused: $out"
grep -q 'X POST https://api.github.com/repos/me/sumi/pulls' "$t/args" && fail "second PR created"
grep -q 'X PATCH .*https://api.github.com/repos/me/sumi/pulls/5' "$t/args" || fail "existing PR title not updated"
[ "$(OPEN_PR='[{"number":5,"html_url":"https://github.com/me/sumi/pull/5"}]' run open-pr sumi issue/exists)" = "5 https://github.com/me/sumi/pull/5" ] || fail "open-pr"
[ -z "$(run open-pr sumi issue/exists)" ] || fail "open-pr with none"
run open-pr sumi main > /dev/null 2>&1 && fail "open-pr accepted main"
# issue 244: a title the repo's pr-title workflow would fail is refused before the push
yml=$(printf '      - uses: amannn/action-semantic-pull-request@v6\n        with:\n          types: |\n            feat\n            fix\n          subjectPattern: ^(?![A-Z])(?!.*\\.$).+$\n')
: > "$t/gitlog"
TITLE_YML=$yml run pr sumi issue/exists "feat(cv): About me" > "$t/o" 2>&1 && fail "capitalised subject accepted"
grep -q "soggetto non rispetta" "$t/o" || fail "no reason for the subject: $(cat "$t/o")"
grep -q " push " "$t/gitlog" && fail "pushed despite a refused title"
TITLE_YML=$yml run pr sumi issue/exists "feat: done." > /dev/null 2>&1 && fail "trailing period accepted"
TITLE_YML=$yml run pr sumi issue/exists "feature: x" > "$t/o" 2>&1 && fail "unknown type accepted"
grep -q "tipo tra: feat fix" "$t/o" || fail "no list of types: $(cat "$t/o")"
FILES=src/a.go TITLE_YML=$yml run pr sumi issue/exists "feat(cv): about me, grouped" > /dev/null || fail "valid title refused"
FILES=src/a.go TITLE_YML=$yml run pr sumi issue/exists "fix!: breaking change" > /dev/null || fail "breaking marker refused"
# issue 206: CI state of a PR
sha=0123456789abcdef0123456789abcdef01234567
pr='[{"state":"open","merged_at":null,"head":{"sha":"'$sha'"}}]'
ci() { ALL_PR=$pr RUNS=$1 run ci sumi issue/exists; }
[ "$(ALL_PR='[]' run ci sumi issue/exists)" = none ] || fail "ci none"
[ "$(ALL_PR='[{"state":"closed","merged_at":"2026-01-01"}]' run ci sumi issue/exists)" = merged ] || fail "ci merged"
[ "$(ALL_PR='[{"state":"closed","merged_at":null}]' run ci sumi issue/exists)" = closed ] || fail "ci closed"
[ "$(ci '{"check_runs":[{"id":1,"name":"a","status":"completed","conclusion":"success"},{"id":2,"name":"b","status":"in_progress","conclusion":null}]}')" = pending ] || fail "ci pending"
[ "$(ci '{"check_runs":[{"id":1,"name":"a","status":"completed","conclusion":"success"},{"id":2,"name":"b","status":"completed","conclusion":"skipped"}]}' | head -n1)" = green ] && [ "$(ci '{"check_runs":[{"id":1,"name":"a","status":"completed","conclusion":"success"},{"id":2,"name":"b","status":"completed","conclusion":"skipped"}]}' | sed -n 2p)" = "head $sha" ] || fail "ci green"
out=$(ci '{"check_runs":[{"id":1,"name":"a","status":"completed","conclusion":"success"},{"id":2,"name":"Backend (lint)","status":"completed","conclusion":"failure"}]}')
[ "$(echo "$out" | head -n1)" = red ] || fail "ci red"
echo "$out" | grep -q '^check: Backend (lint)$' || fail "ci red: check name"
echo "$out" | grep -q 'backend/client.go:93 Error return value of os.RemoveAll' || fail "ci red: annotation"
# issue 244: a stale failure of the same check (an older run on the same commit) does not count
[ "$(ci '{"check_runs":[{"id":3,"name":"PR title","status":"completed","conclusion":"failure"},{"id":9,"name":"PR title","status":"completed","conclusion":"success"},{"id":4,"name":"ci-ok","status":"completed","conclusion":"success"}]}' | head -n1)" = green ] || fail "ci: stale failure counted"
[ "$(ci '{"check_runs":[{"id":9,"name":"PR title","status":"completed","conclusion":"failure"},{"id":3,"name":"PR title","status":"completed","conclusion":"success"}]}' | head -n1)" = red ] || fail "ci: newest failure ignored"
run ci sumi main > /dev/null 2>&1 && fail "ci accepted main"
# issue 232: a PR that conflicts with main
prn='[{"number":7,"state":"open","merged_at":null,"head":{"sha":"'$sha'"}}]'
out=$(PR7='{"mergeable":false}' ALL_PR="$prn" RUNS='{"check_runs":[{"id":1,"name":"ci-ok","status":"completed","conclusion":"success"}]}' run ci sumi issue/exists)
[ "$(echo "$out" | head -n1)" = conflict ] && echo "$out" | grep -q "^check: conflitto con main\$" || fail "ci conflict: $out"
[ "$(PR7='{"mergeable":true}' ALL_PR="$prn" RUNS='{"check_runs":[{"id":1,"name":"a","status":"completed","conclusion":"success"}]}' run ci sumi issue/exists | head -n1)" = green ] || fail "ci: mergeable PR not green"
[ "$(PR7='{"mergeable":null}' ALL_PR="$prn" RUNS='{"check_runs":[{"id":1,"name":"a","status":"completed","conclusion":"success"}]}' run ci sumi issue/exists | head -n1)" = green ] || fail "ci: unknown mergeable treated as conflict"
# issue 208: release-data / release
bot='{"number":7,"title":"chore: release main","body":"## [0.5.0] x","html_url":"https://github.com/me/sumi/pull/7","head":{"ref":"release-please--branches--main","sha":"'$sha'"},"user":{"type":"Bot"},"state":"open","merged":false}'
RELRUNS='{"check_runs":[{"id":1,"name":"a","status":"completed","conclusion":"success"}]}'
out=$(REL_PRS="[$bot]" RUNS=$RELRUNS run release-data sumi) || fail "release-data"
[ "$(echo "$out" | jq -r '"\(.pr.number) \(.ci) \(.last.tag) \(.pr.parent) \(.pr.parent_at)"')" = "7 green v0.4.0 1111111111111111111111111111111111111111 2026-10-01T00:00:00Z" ] || fail "release-data fields: $out"
[ "$(REL_PRS='[{"number":8,"head":{"ref":"feature","sha":"x"},"user":{"type":"Bot"}},{"number":9,"head":{"ref":"release-please--b","sha":"x"},"user":{"type":"User"}}]' run release-data sumi | jq -c .pr)" = null ] || fail "release-data took a non-bot or non-release PR"
[ "$(PR7="$bot" run release sumi 7 $sha)" = "merged 7 (squash)" ] || fail "release merge"
PR7="$bot" run release sumi 7 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa > /dev/null 2>&1 && fail "release merged at another head"
PR7=$(echo "$bot" | jq -c '.user.type="User"') run release sumi 7 $sha > /dev/null 2>&1 && fail "release merged a non-bot PR"
PR7=$(echo "$bot" | jq -c '.head.ref="issue/7-x"') run release sumi 7 $sha > /dev/null 2>&1 && fail "release merged a non-release branch"
PR7="$bot" MERGE_RES='{"merged":false}' run release sumi 7 $sha > /dev/null 2>&1 && fail "release ignored a refused merge"
# issue 323: behind main
[ "$(PR7='{"mergeable":true,"mergeable_state":"behind"}' ALL_PR="$prn" RUNS='{"check_runs":[{"id":1,"name":"a","status":"completed","conclusion":"success"}]}' run ci sumi issue/exists | tr "\n" " ")" = "behind head $sha " ] || fail "ci: behind not reported"
[ "$(PR7='{"mergeable":true,"mergeable_state":"clean"}' ALL_PR="$prn" RUNS='{"check_runs":[{"id":1,"name":"a","status":"completed","conclusion":"success"}]}' run ci sumi issue/exists | head -n1)" = green ] || fail "ci: clean not green"
# issue 232: rules / merge
GOOD='[{"type":"deletion"},{"type":"non_fast_forward"},{"type":"pull_request"},{"type":"required_status_checks","parameters":{"required_status_checks":[{"context":"ci-ok"}]}}]'
[ "$(RULES="$GOOD" run rules sumi | jq -r .ok)" = true ] || fail "rules: complete ruleset not ok"
[ "$(jq -r .project "$t/ruleset-sumi.json")" = sumi ] || fail "rules: status file"
[ "$(RULES='[{"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":true,"required_status_checks":[{"context":"ci-ok"}]}}]' run rules sumi | jq -r .strict)" = true ] || fail "rules: strict not reported"
[ "$(RULES='[]' run rules sumi | jq -c '[.ok,.ci_ok,.pull_request]')" = "[false,false,false]" ] || fail "rules: empty ruleset ok"
[ "$(RULES='[{"type":"deletion"},{"type":"non_fast_forward"},{"type":"pull_request"},{"type":"required_status_checks","parameters":{"required_status_checks":[{"context":"build"}]}}]' run rules sumi | jq -r .ok)" = false ] || fail "rules: ci-ok not required but ok"
GREEN='{"check_runs":[{"id":1,"name":"a","status":"completed","conclusion":"success"},{"id":2,"name":"ci-ok","status":"completed","conclusion":"success"}]}'
PRI='{"state":"open","merged":false,"base":{"ref":"main"},"head":{"ref":"issue/7-x","sha":"'$sha'","repo":{"full_name":"me/sumi"}}}'
mg() { PR7=${PR7:-$PRI} RULES=${RULES:-$GOOD} RUNS=${RUNS:-$GREEN} FILES=${FILES:-src/a.go} run merge sumi 7 ${HEADSHA:-$sha}; }
[ "$(mg)" = "merged 7 (squash)" ] || fail "merge: all conditions met but not merged"
tr -d "\n" < "$t/args" | grep -q "PUT.*pulls/7/merge" || fail "merge: no PUT"
tr -d "\n" < "$t/args" | grep -q "DELETE.*git/refs/heads/issue/7-x" || fail "merge: branch not deleted"
HEADSHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa mg > /dev/null 2>&1 && fail "merge: head moved"
ub() { PR7=${PR7:-$PRI} run update-branch sumi 7 ${HEADSHA:-$sha}; }
[ "$(ub)" = "updated 7" ] || fail "update-branch: not done"
tr -d "\n" < "$t/args" | grep -q "PUT.*pulls/7/update-branch" || fail "update-branch: no PUT"
HEADSHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ub > /dev/null 2>&1 && fail "update-branch: head moved"
PR7=$(echo "$PRI" | jq -c '.head.ref="main"') ub > /dev/null 2>&1 && fail "update-branch: non issue/ branch"
PR7=$(echo "$PRI" | jq -c '.head.repo.full_name="o/fork"') ub > /dev/null 2>&1 && fail "update-branch: fork"
PR7=$(echo "$PRI" | jq -c '.head.ref="feature/x"') mg > /dev/null 2>&1 && fail "merge: non issue/ branch"
PR7=$(echo "$PRI" | jq -c '.head.repo.full_name="o/fork"') mg > /dev/null 2>&1 && fail "merge: fork"
PR7=$(echo "$PRI" | jq -c '.base.ref="dev"') mg > /dev/null 2>&1 && fail "merge: other base"
PR7=$(echo "$PRI" | jq -c '.state="closed"') mg > /dev/null 2>&1 && fail "merge: closed PR"
RUNS='{"check_runs":[]}' mg > /dev/null 2>&1 && fail "merge: no checks"
RUNS='{"check_runs":[{"id":1,"name":"ci-ok","status":"completed","conclusion":"success"},{"id":2,"name":"b","status":"in_progress","conclusion":null}]}' mg > /dev/null 2>&1 && fail "merge: pending check"
RUNS='{"check_runs":[{"id":1,"name":"ci-ok","status":"completed","conclusion":"success"},{"id":2,"name":"b","status":"completed","conclusion":"failure"}]}' mg > /dev/null 2>&1 && fail "merge: red check"
RUNS='{"check_runs":[{"id":1,"name":"a","status":"completed","conclusion":"success"}]}' mg > /dev/null 2>&1 && fail "merge: ci-ok missing"
RUNS='{"check_runs":[{"id":1,"name":"ci-ok","status":"completed","conclusion":"skipped"}]}' mg > /dev/null 2>&1 && fail "merge: ci-ok skipped"
RULES='[]' mg > /dev/null 2>&1 && fail "merge: no ruleset"
RULES='[{"type":"pull_request"}]' mg > /dev/null 2>&1 && fail "merge: partial ruleset"
for f in .github/workflows/ci.yml frontend/package.json go.mod deploy/x.sh .hs-tools Dockerfile; do FILES=$f mg > /dev/null 2>&1 && fail "merge: sensitive file $f"; done
MERGE_RES='{"merged":false}' mg > /dev/null 2>&1 && fail "merge: refused merge reported as done"
mg > /dev/null 2>&1 || fail "merge: stable"
# prune: only merged issue/* branches are deleted
: > "$t/args"
REFS='[{"ref":"refs/heads/issue/5-a"},{"ref":"refs/heads/issue/6-b"}]' ALL_PR='[{"state":"closed","merged_at":"2026-01-01"}]' run prune sumi | grep -qx "deleted issue/5-a" || fail "prune: merged branch kept"
grep -q "DELETE.*heads/issue/6-b" "$t/args" || fail "prune: second merged branch kept"
: > "$t/args"
REFS='[{"ref":"refs/heads/issue/5-a"}]' ALL_PR='[{"state":"open","merged_at":null,"head":{"sha":"x"}}]' run prune sumi > /dev/null 2>&1
grep -q DELETE "$t/args" && fail "prune: deleted a branch without a merged PR"
# issue 266: Actions instead of check-runs when the token cannot read them
export NOCHECKS=1
export AREPLY='{"workflow_runs":[{"id":5,"workflow_id":1,"name":"CI","status":"completed","conclusion":"failure"},{"id":9,"workflow_id":1,"name":"CI","status":"completed","conclusion":"success"}]}'
export JOBS='{"jobs":[{"id":21,"name":"a","status":"completed","conclusion":"success"},{"id":22,"name":"ci-ok","status":"completed","conclusion":"success"}]}'
[ "$(RUNS= run commit-ci sumi $sha)" = green ] || fail "actions: green commit"
[ "$(RUNS= mg)" = "merged 7 (squash)" ] || fail "actions: merge"
JOBS='{"jobs":[{"id":21,"name":"a","status":"completed","conclusion":"failure"},{"id":22,"name":"ci-ok","status":"completed","conclusion":"skipped"}]}' run commit-ci sumi $sha | grep -qx red || fail "actions: red job"
JOBS='{"jobs":[{"id":21,"name":"a","status":"in_progress","conclusion":null}]}' run commit-ci sumi $sha | grep -qx pending || fail "actions: pending job"
JOBS='{"jobs":[{"id":21,"name":"a","status":"completed","conclusion":"success"}]}' run commit-ci sumi $sha | grep -qx pending || fail "actions: ci-ok missing"
AREPLY='{"workflow_runs":[]}' run commit-ci sumi $sha | grep -qx pending || fail "actions: no runs"
AREPLY='{"workflow_runs":[{"id":9,"workflow_id":1,"name":"CI","status":"queued","conclusion":null}]}' JOBS='{"jobs":[]}' run commit-ci sumi $sha | grep -qx pending || fail "actions: queued run"
unset NOCHECKS
echo "projects-publish: ok"
# issue 219: close-pr closes only open PRs on our branches, with a comment; pr closes the older PR of the same issue
cat > "$t/bin/curl" <<'EOS'
#!/bin/sh
cat > "$CURL_STDIN"
echo "$*" >> "$CURL_ARGS"
case "$*" in
*"-X GET"*"pulls?state=open&per_page=100"*) printf '%s\n' "${OLD_PRS:-[]}" ;;
*"-X GET"*"pulls?head=me:"*"state=open"*) echo '[]' ;;
*"-X GET"*/pulls/226) echo '{"state":"open","merged":false,"head":{"ref":"claude/215-feat","repo":{"full_name":"me/sumi"}}}' ;;
*"-X GET"*/pulls/230) echo '{"state":"open","merged":false,"head":{"ref":"feature/x","repo":{"full_name":"me/sumi"}}}' ;;
*"-X GET"*/pulls/231) echo '{"state":"open","merged":false,"head":{"ref":"issue/9-x","repo":{"full_name":"other/sumi"}}}' ;;
*"-X GET"*/pulls/232) echo '{"state":"closed","merged":true,"head":{"ref":"issue/9-x","repo":{"full_name":"me/sumi"}}}' ;;
*"-X GET"*/issues/5) echo '{"state":"closed"}' ;;
*"-X GET"*/pulls/7/files*) echo '[{"filename":"src/a.go"}]' ;;
*"-X POST"*/pulls) echo '{"number":227,"node_id":"N","html_url":"https://github.com/me/sumi/pull/227"}' ;;
*graphql*) echo '{"data":{}}' ;;
*"-X GET"*/pulls/227/files*) echo '[{"filename":"src/a.go"}]' ;;
*) echo '{}' ;;
esac
EOS
: > "$t/args"
out=$(run close-pr sumi 226 227)
echo "$out" | grep -q 'closed 226 (claude/215-feat)' || fail "close-pr output"
tr -d '\n' < "$t/args" | grep -q 'Sostituita da #227.*issues/226/comments' || fail "close-pr comment"
grep -q 'PATCH.*closed.*pulls/226' "$t/args" || fail "close-pr patch"
grep -q 'DELETE.*git/refs/heads/claude/215-feat' "$t/args" || fail "close-pr branch delete"
for n in 230 231 232; do run close-pr sumi $n > /dev/null 2>&1 && fail "close-pr accepted PR $n"; done
run close-pr sumi abc > /dev/null 2>&1 && fail "close-pr accepted a bad number"
[ "$(run issue-state sumi 5)" = closed ] || fail "issue-state"
: > "$t/args"
out=$(OLD_PRS='[{"number":226,"head":{"ref":"claude/215-feat"}},{"number":240,"head":{"ref":"issue/2150-other"}},{"number":227,"head":{"ref":"issue/215-new"}}]' run pr sumi issue/215-new T)
grep -q 'PATCH.*pulls/226' "$t/args" || fail "pr did not close the older PR"
grep -q 'PATCH.*pulls/240' "$t/args" && fail "pr closed a PR of issue 2150"
grep -q 'PATCH.*pulls/227' "$t/args" && fail "pr closed the new PR"
: > "$t/args"; run pr sumi issue/dep T > /dev/null
grep -q PATCH "$t/args" && fail "pr without an issue id closed something"
echo "projects-publish close-pr: ok"
