#!/bin/sh
# Test of projects-git (issue 190) with a stubbed git: for https://github.com/ URLs the token
# reaches git only through GIT_ASKPASS (never argv, never another env var), the askpass file is
# gone afterwards, output stays clean; without the token file, or for other hosts, no askpass.
# From the repo root: device/edge/tests/projects-git.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin" "$t/home/.secrets" "$t/clone"
echo SECRETTOKEN > "$t/home/.secrets/git-github"
cat > "$t/bin/git" <<'EOS'
#!/bin/sh
echo "$*" >> "$GIT_LOG"
env | grep -v '^GIT_ASKPASS=' | grep -q SECRETTOKEN && echo leak >> "$GIT_LOG"
[ "$1" = -C ] && [ "$3" = remote ] && { echo "$ORIGIN_URL"; exit 0; }
if [ -n "${GIT_ASKPASS:-}" ]; then
	echo "askpass user=$("$GIT_ASKPASS" 'Username for x') pw=$("$GIT_ASKPASS" 'Password for x')" >> "$GIT_LOG"
	echo "$GIT_ASKPASS" > "$ASK_PATH"
else echo noaskpass >> "$GIT_LOG"; fi
echo "prompt=$GIT_TERMINAL_PROMPT" >> "$GIT_LOG"
EOS
chmod +x "$t/bin/git"
export GIT_LOG=$t/log ASK_PATH=$t/ask
run() { : > "$GIT_LOG"; rm -f "$ASK_PATH"; HOME=$t/home PATH=$t/bin:$PATH sh "$R/device/edge/debian/projects-git" "$@" 2>&1; }
fail() { echo "FAIL: $1"; cat "$GIT_LOG"; exit 1; }

out=$(run ls-remote https://github.com/me/p.git HEAD)
grep -q 'askpass user=x-access-token pw=SECRETTOKEN' "$GIT_LOG" || fail "ls-remote: token not given through askpass"
grep -q SECRETTOKEN "$GIT_LOG" && [ "$(grep -c SECRETTOKEN "$GIT_LOG")" -ne 1 ] && fail "token elsewhere"
grep -q leak "$GIT_LOG" && fail "token in the environment"
grep -q '^ls-remote -q https://github.com/me/p.git HEAD$' "$GIT_LOG" || fail "ls-remote args"
grep -q 'prompt=0' "$GIT_LOG" || fail "prompts not disabled"
[ ! -e "$(cat "$ASK_PATH")" ] || fail "askpass left behind"
case $out in *SECRETTOKEN*) fail "token in output" ;; esac

run clone https://github.com/me/p.git "$t/clone/p" > /dev/null
grep -q '^clone -q https://github.com/me/p.git ' "$GIT_LOG" || fail "clone args"
grep -q 'pw=SECRETTOKEN' "$GIT_LOG" || fail "clone: no token"

ORIGIN_URL=https://github.com/me/p.git run fetch "$t/clone" abc123 > /dev/null
ORIGIN_URL=https://github.com/me/p.git; export ORIGIN_URL
run fetch "$t/clone" abc123 > /dev/null
grep -q "^-C $t/clone fetch -q origin abc123$" "$GIT_LOG" || fail "fetch args"
grep -q 'pw=SECRETTOKEN' "$GIT_LOG" || fail "fetch: no token"

ORIGIN_URL=https://gitlab.com/me/p.git; export ORIGIN_URL
run fetch "$t/clone" > /dev/null
grep -q noaskpass "$GIT_LOG" || fail "token given to a non-github host"
run ls-remote https://gitlab.com/me/p.git HEAD > /dev/null
grep -q noaskpass "$GIT_LOG" || fail "ls-remote: token given to a non-github host"

rm "$t/home/.secrets/git-github"
run ls-remote https://github.com/me/p.git HEAD > /dev/null
grep -q noaskpass "$GIT_LOG" || fail "without token file askpass still used"
run bogus x > /dev/null && fail "unknown command accepted"
echo "projects-git ok"
