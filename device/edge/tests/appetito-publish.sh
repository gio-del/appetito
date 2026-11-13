#!/bin/sh
# Test of scripts/appetito-publish (issue 560): the one command that writes to main of Appetito's repo.
# A local bare repo plays GitHub (HS_APPETITO_URL in a test env file); no network, no token. It checks: off
# without HS_APPETITO_REPO, wrong origin, a Project refused, dirty tree, diverged history (never forced),
# files outside the list, a failing check, a failing secrets verdict or attribution, --dry-run publishes
# nothing, a good publish moves main, a second run has nothing to do, no option to force.
# From the repo root: device/edge/tests/appetito-publish.sh
set -eu
P=$(pwd)/scripts/appetito-publish
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_AUTHOR_NAME=T GIT_AUTHOR_EMAIL=t@localhost GIT_COMMITTER_NAME=T GIT_COMMITTER_EMAIL=t@localhost
git init -q --bare -b main "$t/remote.git"
git clone -q "$t/remote.git" "$t/seed" 2> /dev/null
(cd "$t/seed" && git checkout -q -b main && echo old > README.md && git add -A && git commit -q -m "vecchia storia" && git push -q origin main)
old=$(git -C "$t/remote.git" rev-parse main)
git clone -q "$t/remote.git" "$t/pub"
(cd "$t/pub" && rm README.md && mkdir sub && echo a > sub/a.sh && echo b > b.txt && git add -A && git commit -q -m "Pubblicazione di prova")
new=$(git -C "$t/pub" rev-parse HEAD)
printf 'HS_APPETITO_REPO=someone/appetito\nHS_APPETITO_URL=%s\n' "$t/remote.git" > "$t/env"
printf '# projects\nhome-server | - | - | active | issues | - | -\nother | https://github.com/someone/other.git | - | active | github | - | -\n' > "$t/projects"
printf 'b.txt\nsub/a.sh\n' > "$t/list"
export HS_ENV_FILE="$t/env" HS_PROJECTS_FILE="$t/projects" HS_APPETITO_FILES_CMD="cat $t/list" HS_APPETITO_CHECK_CMD=true HS_SECRETS_CMD=true HS_ATTRIBUTION_CMD=true HS_GIT_TOKEN="$t/none"
remote() { git -C "$t/remote.git" rev-parse main; }
refused() { # NAME PATTERN [ARGS...]: must exit != 0, say PATTERN, and leave the remote alone
	n=$1; pat=$2; shift 2
	out=$(sh "$P" "$@" 2>&1) && fail "$n: accepted: $out"
	echo "$out" | grep -q -- "$pat" || fail "$n: message: $out"
	[ "$(remote)" = "$old" ] || fail "$n: the remote moved"
}

# off, bad values, wrong place
printf 'HS_APPETITO_REPO=\n' > "$t/off"; HS_ENV_FILE="$t/off" refused "off" "spenta" "$t/pub"
printf 'HS_APPETITO_REPO=../x/y\nHS_APPETITO_URL=%s\n' "$t/remote.git" > "$t/bad"; HS_ENV_FILE="$t/bad" refused "bad repo name" "non valido" "$t/pub"
printf 'HS_APPETITO_REPO=someone/other\nHS_APPETITO_URL=%s\n' "$t/remote.git" > "$t/proj"; HS_ENV_FILE="$t/proj" refused "a Project" "Project" "$t/pub"
refused "not a repo" "non e' un repo" "$t"
git clone -q "$t/remote.git" "$t/elsewhere"; git -C "$t/elsewhere" remote set-url origin "$t/seed"
refused "wrong origin" "origin" "$t/elsewhere"
refused "no force option" "opzione sconosciuta" --force "$t/pub"
refused "no force option (short)" "opzione sconosciuta" -f "$t/pub"
# dirty tree, other branch
echo x > "$t/pub/dirty"; refused "dirty tree" "non committate" "$t/pub"; rm "$t/pub/dirty"
git -C "$t/pub" checkout -q -b side; refused "other branch" "main" "$t/pub"; git -C "$t/pub" checkout -q main
# history that is not on top of the published one: refused, never forced
git clone -q "$t/remote.git" "$t/div"
(cd "$t/div" && git checkout -q --orphan fresh && git rm -q -rf . && mkdir sub && echo a > sub/a.sh && echo b > b.txt && git add -A && git commit -q -m "storia nuova" && git branch -q -M main)
refused "diverged history" "non sta sopra" "$t/div"
# files, checks
printf 'b.txt\n' > "$t/list"; refused "file outside the list" "non sono l'elenco" "$t/pub"
printf 'b.txt\nsub/a.sh\nmissing.txt\n' > "$t/list"; refused "file missing from the copy" "non sono l'elenco" "$t/pub"
printf 'b.txt\nsub/a.sh\n' > "$t/list"
HS_APPETITO_CHECK_CMD=false refused "failing check" "controllo dei file" "$t/pub"
HS_SECRETS_CMD=false refused "secrets verdict" "segreti" "$t/pub"
HS_ATTRIBUTION_CMD=false refused "attribution" "attribuzione" "$t/pub"
# the check sees the files of the commit, without .git
printf '#!/bin/sh\n[ -f "$1/sub/a.sh" ] && [ ! -e "$1/.git" ] && [ ! -e "$1/README.md" ]\n' > "$t/chk"; chmod +x "$t/chk"
# dry run: every check, nothing published
out=$(HS_APPETITO_CHECK_CMD="$t/chk" sh "$P" --dry-run "$t/pub" 2>&1) || fail "dry run refused: $out"
echo "$out" | grep -q "prova riuscita: 1 commit" || fail "dry run message: $out"
[ "$(remote)" = "$old" ] || fail "dry run published"
# the real thing: main moves forward to the local commit, the old history is still there
out=$(HS_APPETITO_CHECK_CMD="$t/chk" sh "$P" "$t/pub" 2>&1) || fail "publish refused: $out"
echo "$out" | grep -q "pubblicato $(echo "$new" | cut -c1-7) su main di someone/appetito (1 commit, 2 file)" || fail "publish message: $out"
[ "$(remote)" = "$new" ] || fail "the remote is not at the new commit"
git -C "$t/remote.git" merge-base --is-ancestor "$old" main || fail "the old history is gone"
old=$new
# again: nothing to do, exit 0
out=$(sh "$P" "$t/pub" 2>&1) || fail "second run failed: $out"
echo "$out" | grep -q "niente da pubblicare" || fail "second run message: $out"
[ "$(remote)" = "$new" ] || fail "second run moved the remote"
# a remote that refuses the push: exit 1, said plainly
printf '#!/bin/sh\nexit 1\n' > "$t/remote.git/hooks/pre-receive"; chmod +x "$t/remote.git/hooks/pre-receive"
(cd "$t/pub" && echo c >> b.txt && git add -A && git commit -q -m "Pubblicazione seconda")
refused "push rejected by the remote" "push rifiutato" "$t/pub"
# the token never appears in the script's own text paths: only through GIT_ASKPASS
grep -q 'GIT_ASKPASS' "$P" || fail "no GIT_ASKPASS"
grep -Eq 'push[^|]*(--force|-f |\+)' "$P" && fail "the script can force a push"
echo "ok: appetito-publish"
