#!/bin/sh
# Test of the attribution guard at every level (issue 474), offline:
# - hs-attribution text/ident: refuses attribution phrases, Claude-Session trailers, the robot emoji and
#   Claude/Anthropic identities; lets through "Claude" as a subject;
# - claude-hook: blocks (exit 2) a Bash commit/push/gh/projects-publish carrying attribution, lets the rest through;
# - the git hooks in a scratch repo: commit-msg refuses, pre-push and pre-receive refuse new commits with an AI
#   trailer, a Claude author or a claude/ branch, and accept clean ones; old history is not re-checked;
# - projects-publish uses the same pattern list.
# From the repo root: device/edge/tests/attribution.sh
set -eu
R=$(cd "$(dirname "$0")/../../.." && pwd)
H=$R/device/edge/debian/hs-attribution
HOOKS=$R/device/edge/git-hooks
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }
export GIT_CONFIG_NOSYSTEM=1 HOME="$T/home"; mkdir -p "$HOME"
git config --global user.name me; git config --global user.email me@x.it; git config --global init.defaultBranch main

# 1. text and ident
for bad in 'Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>' 'Claude-Session: https://claude.ai/code/session_01X' \
	'🤖 Generated with [Claude Code](https://claude.com/claude-code)' 'Written with the help of an AI' 'AI-generated summary' \
	'_Preparata in automatico da ops-auto sul server (Claude Code), da rivedere come ogni PR._' 'Scritto con Claude' 'Generata da un AI'; do
	printf 'fix: thing\n\n%s\n' "$bad" | "$H" text > /dev/null && fail "text accepted: $bad"
done
for ok in 'fix: the user'"'"'s Claude session restarts after updates' 'docs: brain uses Claude Code headless' 'feat: tailor the CV' 'Claude Code lavora in una sessione dedicata sul server' 'La PR è stata preparata dal gruppo di lavoro'; do
	printf '%s\n' "$ok" | "$H" text > /dev/null || fail "text refused: $ok"
done
echo 'claude/12-fix' | "$H" ident > /dev/null && fail "ident accepted a claude/ branch"
echo 'issue/12-fix' | "$H" ident > /dev/null || fail "ident refused issue/12-fix"

# 2. claude-hook
hook() { jq -n --arg t "$1" --arg c "$2" '{tool_name: $t, tool_input: {command: $c}}' | "$H" claude-hook 2> /dev/null; }
set +e
hook Bash "git commit -qm \"x

Claude-Session: https://claude.ai/code/session_1\""; [ $? = 2 ] || fail "hook let a commit with Claude-Session through"
hook Bash "gh pr create --body 'Generated with Claude Code'"; [ $? = 2 ] || fail "hook let gh pr with attribution through"
hook Bash "git -C repo commit --author='Claude <noreply@anthropic.com>' -m x"; [ $? = 2 ] || fail "hook let a Claude author through"
hook Bash "git log -i --grep='Claude-Session'"; [ $? = 0 ] || fail "hook blocked a read-only git log"
hook Bash "grep -n 'Co-Authored-By: Claude' tests/x.sh"; [ $? = 0 ] || fail "hook blocked a grep"
hook Bash "git commit -qm 'fix: clean message'"; [ $? = 0 ] || fail "hook blocked a clean commit"
hook Write "Co-Authored-By: Claude"; [ $? = 0 ] || fail "hook judged a non-Bash tool"
set -e

# 3. git hooks in scratch repos (hooks copied with hs-attribution next to them, as in the repo layout)
mkdir -p "$T/edge/git-hooks" "$T/edge/debian"
cp "$HOOKS/commit-msg" "$HOOKS/pre-push" "$HOOKS/pre-receive" "$HOOKS/attribution-common.sh" "$T/edge/git-hooks/"
cp "$H" "$T/edge/debian/"
# the secrets scan of pre-push has its own test (hs-secrets.sh): here a stub that finds nothing
export HS_SECRETS_CMD=true
W=$T/work; B=$T/remote.git
git init -q "$W"; git init -q --bare "$B"
# old history with a trailer, pushed before the guard: never re-checked
git -C "$W" commit -q --allow-empty -m 'old

Co-Authored-By: Claude <noreply@anthropic.com>'
git -C "$W" remote add origin "$B"; git -C "$W" push -q origin main
git -C "$W" config core.hooksPath "$T/edge/git-hooks"; git -C "$B" config core.hooksPath "$T/edge/git-hooks"
git -C "$W" commit -q --allow-empty -m 'x

Claude-Session: https://claude.ai/code/session_1' 2> /dev/null && fail "commit-msg accepted Claude-Session"
git -C "$W" commit -q --allow-empty -m 'feat: clean' || fail "commit-msg refused a clean message"
git -C "$W" push -q origin main 2> /dev/null || fail "push of a clean commit refused (old history re-checked?)"
git -C "$W" commit -q --no-verify --allow-empty -m 'y

Co-authored-by: Claude <noreply@anthropic.com>'
git -C "$W" push -q origin main 2> /dev/null && fail "pre-push accepted an AI trailer"
git -C "$W" push -q --no-verify origin main 2> /dev/null && fail "pre-receive accepted an AI trailer"
git -C "$W" reset -q --hard HEAD~1
git -C "$W" -c user.name=Claude -c user.email=noreply@anthropic.com commit -q --allow-empty -m 'z'
git -C "$W" push -q --no-verify origin main 2> /dev/null && fail "pre-receive accepted a Claude author"
git -C "$W" reset -q --hard HEAD~1
git -C "$W" push -q --no-verify origin main:claude/1-x 2> /dev/null && fail "pre-receive accepted a claude/ branch"
git -C "$W" push -q origin main:issue/1-x 2> /dev/null || fail "push to issue/1-x refused"

# 4. one list: projects-publish takes its patterns from hs-attribution
grep -q 'hs-attribution' "$R/device/edge/debian/projects-publish" || fail "projects-publish keeps its own pattern list"
echo "attribution: ok"
