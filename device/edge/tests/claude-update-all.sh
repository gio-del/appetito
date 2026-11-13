#!/bin/sh
# Test of claude-update-all (issue 442) with fake users and a fake updater: a user behind is updated, one aligned is not
# touched (no log line), a failing update is logged and fails the job. Offline. From the repo root: device/edge/tests/claude-update-all.sh
set -eu
R=$(cd "$(dirname "$0")/../../.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }
for u in behind ok bad; do mkdir -p "$T/$u/.local/bin" "$T/$u/.local/share/claude/versions"; done
mkdir -p "$T/none"
# fake binary: "update" moves the link to 2.0.2 (behind) or fails (bad)
for u in behind ok bad; do
	v=2.0.1; [ $u = ok ] && v=2.0.2
	printf '#!/bin/sh\ncase "$0" in *bad*) echo boom >&2; exit 1;; esac\nd=$(dirname "$0")/../share/claude/versions\nif [ ! -e $d/2.0.2 ]; then cp "$0" $d/2.0.2; fi\nln -sf $d/2.0.2 "$(dirname "$0")/claude"\n' > "$T/$u/.local/share/claude/versions/$v"
	chmod +x "$T/$u/.local/share/claude/versions/$v"
	ln -sf "$T/$u/.local/share/claude/versions/$v" "$T/$u/.local/bin/claude"
done
printf '#!/bin/sh\nshift\nexec "$@"\n' > "$T/as"; chmod +x "$T/as"
export CLAUDE_UPDATE_AS="$T/as" CLAUDE_UPDATE_USERS="behind:$T/behind ok:$T/ok bad:$T/bad none:$T/none"
rc=0; sh "$R/device/edge/debian/claude-update-all" > "$T/o" || rc=$?
[ "$rc" = 1 ] || fail "a failing update must exit 1 (got $rc)"
grep -q "behind: 2.0.1 -> 2.0.2" "$T/o" || fail "behind not updated: $(cat "$T/o")"
grep -q "bad: update FAILED" "$T/o" || fail "failure not logged"
grep -q "ok:" "$T/o" && fail "aligned user must not log"
grep -q "none" "$T/o" && fail "user without claude must be skipped"
rm -rf "$T/bad"; export CLAUDE_UPDATE_USERS="behind:$T/behind ok:$T/ok"
sh "$R/device/edge/debian/claude-update-all" > "$T/o" || fail "clean run must exit 0"
echo "claude-update-all: ok"
