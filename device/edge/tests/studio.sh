#!/bin/sh
# Test of the study session's pieces (issue 448), offline:
# - the runit run file starts Claude restricted (no shell), with web tools, without MCP, as studio without new privileges;
# - studio-setup without --enable and without the service link does nothing;
# - studio-autocommit commits the folder into a git dir outside it, and a hook planted there is never run;
# - brain-refresh with the arguments of another session: a user that does not exist is a no-op;
# - studio-fw.sh blocks loopback, LAN, tailnet and link-local, and its syntax is valid.
# From the repo root: device/edge/tests/studio.sh
set -eu
R=$(cd "$(dirname "$0")/../../.." && pwd)
D=$R/device/edge/debian
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

# 1. run file
RUN=$D/sv/studio/run
for want in '--restricted' '--strict-mcp-config' '--remote-control studio' '--no-new-privs' 'setpriv --reuid=studio'; do
	grep -qF -- "$want" "$RUN" || fail "run lacks $want"
done
tools=$(grep -o -- '--tools [^ ]*' "$RUN" | cut -d' ' -f2)
echo ",$tools," | grep -q ',WebFetch,' || fail "run: no WebFetch in --tools ($tools)"
echo ",$tools," | grep -q ',WebSearch,' || fail "run: no WebSearch in --tools ($tools)"
echo ",$tools," | grep -qiE ',(Bash|PowerShell|NotebookEdit),' && fail "run: --tools must not name a code-running tool ($tools)"
grep -q 'dangerously\|bypassPermissions' "$RUN" && fail "run: no bypass, ever"

# 2. setup off by default
HS_SERVICE_DIR=$T/none sh "$D/studio-setup" > "$T/o" 2>&1 || fail "setup without --enable must exit 0: $(cat "$T/o")"
[ -s "$T/o" ] && fail "setup without --enable must do nothing: $(cat "$T/o")"

# 3. autocommit: git dir outside the folder, hooks never run
H=$T/home; mkdir -p "$H/studio" "$H/.local/state"
git --git-dir="$H/.local/state/studio.git" --work-tree="$H/studio" init -q -b main
git --git-dir="$H/.local/state/studio.git" config user.name t; git --git-dir="$H/.local/state/studio.git" config user.email t@t
printf '#!/bin/sh\ntouch "%s/hook-ran"\n' "$T" > "$H/.local/state/studio.git/hooks/post-commit"
chmod +x "$H/.local/state/studio.git/hooks/post-commit"
echo "piano" > "$H/studio/programma.md"
printf '#!/bin/sh\nexec "$@"\n' > "$T/as"; chmod +x "$T/as"
mkdir -p "$T/bin"; cp "$D/vault-autocommit" "$T/bin/vault-autocommit"; chmod +x "$T/bin/vault-autocommit"
sed "s#/usr/local/bin/vault-autocommit#$T/bin/vault-autocommit#" "$D/studio-autocommit" > "$T/autocommit"
STUDIO_HOME=$H STUDIO_AS=$T/as sh "$T/autocommit" || fail "autocommit failed"
[ "$(git --git-dir="$H/.local/state/studio.git" log --oneline | wc -l)" = 1 ] || fail "autocommit: no commit"
git --git-dir="$H/.local/state/studio.git" show --name-only --format= HEAD | grep -qx programma.md || fail "autocommit: file not committed"
[ -e "$H/studio/.git" ] && fail "autocommit: a .git appeared inside the folder"
[ -e "$T/hook-ran" ] && fail "autocommit: a hook ran"
STUDIO_HOME=$H STUDIO_AS=$T/as sh "$T/autocommit" || fail "autocommit with nothing new must exit 0"
STUDIO_HOME=$T/nobody sh "$D/studio-autocommit" || fail "autocommit without the user must be a no-op"

# 4. brain-refresh for a session whose user does not exist
sh "$D/brain-refresh" hs-test-no-such-user /nowhere > "$T/o" 2>&1 || fail "brain-refresh for a missing user must exit 0"
[ -s "$T/o" ] && fail "brain-refresh for a missing user must say nothing: $(cat "$T/o")"

# 5. firewall
FW=$R/device/edge/studio-fw.sh
sh -n "$FW" || fail "studio-fw.sh syntax"
grep -q '^STUDIO_UID=906$' "$FW" || fail "studio-fw.sh: uid must be 906 (studio-setup)"
grep -q 'STUDIO_ID=906$' "$D/studio-setup" || fail "studio-setup: uid must be 906 (studio-fw.sh)"
for n in 127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16 ::1/128 fc00::/7 fe80::/10; do
	grep -qF "$n" "$FW" || fail "studio-fw.sh does not block $n"
done
echo "studio: ok"
