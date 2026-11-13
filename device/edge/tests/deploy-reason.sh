#!/bin/sh
# Test of the reasons device/edge/deploy logs on failure (issue 394): a broken check and a broken
# install (staging) in a throwaway tree with a fake check, HOME in a temp dir. No bare "other".
# From the repo root: device/edge/tests/deploy-reason.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
mkdir -p "$t/repo/device/edge/debian" "$t/home"
git -C "$t/repo" init -q
cp "$R/device/edge/deploy" "$t/repo/device/edge/deploy"
echo "HS_TS_NAME=x" > "$t/repo/device/edge/home-server.env"
last() { sed -n '$p' "$t/home/.local/state/deploy.log" | cut -d' ' -f3-; }

printf '#!/bin/sh\necho "FAIL weird tool --x"\nexit 1\n' > "$t/repo/device/edge/check"; chmod +x "$t/repo/device/edge/check"
HOME=$t/home "$t/repo/device/edge/deploy" >/dev/null 2>&1 && rc=0 || rc=$?
check "check rotto: exit" "$rc" 1
check "check rotto: motivo" "$(last)" "failed check: step:weird_tool_--x"

printf '#!/bin/sh\nexit 1\n' > "$t/repo/device/edge/check"
HOME=$t/home "$t/repo/device/edge/deploy" >/dev/null 2>&1 || true
check "check senza FAIL" "$(last)" "failed check: nofail"

printf '#!/bin/sh\necho "FAIL test x/tracker-ui.sh"\nexit 1\n' > "$t/repo/device/edge/check"
HOME=$t/home "$t/repo/device/edge/deploy" >/dev/null 2>&1 || true
check "test rotto" "$(last)" "failed check: test:tracker-ui.sh"

printf '#!/bin/sh\nexit 0\n' > "$t/repo/device/edge/check"
printf '#!/bin/sh\nexit 0\n' > "$t/repo/device/edge/projects-check"; chmod +x "$t/repo/device/edge/projects-check"
HOME=$t/home "$t/repo/device/edge/deploy" >/dev/null 2>&1 || true
check "install rotto (staging)" "$(last)" "failed install: stage"
[ "$fail" = 0 ]
