#!/bin/sh
# Contract test for one agent-run backend: tests/contract/agent-run.sh BACKEND
# Needs the backend configured in the environment (see docs/agent-run.md). For `fake` it
# writes its own scripts. Checks: valid outputs, the edit profile can write, read-only can't,
# exit codes for success and timeout.
set -eu
B=${1:?backend}
HERE=$(cd "$(dirname "$0")" && pwd)
AR=$HERE/../../guard/agent-run/agent-run
T=$(mktemp -d)
trap '[ -n "${KEEP:-}" ] || rm -rf "$T"' EXIT
mkdir -p "$T/w"
printf 'Create a file named hello.txt in the current directory containing exactly the word hi. Do nothing else.\n' > "$T/p-write"
if [ "$B" = fake ]; then
	printf '%s\n' '{"steps":[{"text":"ok"},{"write":"hello.txt","content":"hi"},{"sh":"true"}],"result":"done"}' > "$T/s-write"
	printf '%s\n' '{"steps":[{"sleep":5}],"result":"slow"}' > "$T/s-slow"
fi
fs() { [ "$B" = fake ] && export APPETITO_FAKE_SCRIPT="$T/$1"; return 0; }

echo "== edit-repo can write"
fs s-write
rc=0; "$AR" --prompt "$T/p-write" --dir "$T/w" --profile edit-repo --backend "$B" --out "$T/o1" --timeout 600 || rc=$?
node "$HERE/validate.js" "$T/o1"
[ -n "${CONTRACT_ONLY:-}" ] || [ "$rc" = 0 ] || { echo "exit $rc, expected 0"; cat "$T/o1/final.txt"; exit 1; }
# CONTRACT_ONLY=1 (small local models): check the contract, not whether the model managed the task.
if [ -z "${CONTRACT_ONLY:-}" ]; then [ -f "$T/w/hello.txt" ] || { echo "hello.txt was not created"; exit 1; }; fi

echo "== read-only can't write"
rm -f "$T/w/hello.txt"
rc=0; "$AR" --prompt "$T/p-write" --dir "$T/w" --profile read-only --backend "$B" --out "$T/o2" --timeout 600 || rc=$?
node "$HERE/validate.js" "$T/o2"
[ ! -e "$T/w/hello.txt" ] || { echo "read-only profile created a file"; exit 1; }

echo "== timeout"
fs s-slow
printf 'Count slowly from 1 to 10000, one number per line, and explain each number.\n' > "$T/p-slow"
rc=0; "$AR" --prompt "$T/p-slow" --dir "$T/w" --profile read-only --backend "$B" --out "$T/o3" --timeout 2 || rc=$?
node "$HERE/validate.js" "$T/o3"
[ "$rc" = 4 ] || { echo "exit $rc, expected 4 (timeout)"; exit 1; }

echo "== refuses root"
if [ "$(id -u)" = 0 ]; then
	rc=0; "$AR" --prompt "$T/p-write" --dir "$T/w" --profile read-only --backend "$B" --out "$T/o4" 2>/dev/null || rc=$?
	[ "$rc" = 2 ] || { echo "ran as root"; exit 1; }
fi
echo "contract: $B ok"
