#!/bin/sh
# Test of ops-refresh (issue 421) with a real tmux on a private socket and a fake "claude" (copy of sleep):
# different version + idle -> session killed; different version + active -> kept; same version -> kept. Offline.
# From the repo root: device/edge/tests/ops-refresh.sh
set -eu
R=$(cd "$(dirname "$0")/../../.." && pwd)
command -v tmux >/dev/null || { echo "SKIP: no tmux"; exit 0; }
T=$(mktemp -d)
# Inside a tmux session (the ops session) $TMUX wins over TMUX_TMPDIR: without the unset every tmux call here,
# and the trap's kill-server, would hit that real server and close the session (issue 450). Before the trap.
unset TMUX; export TMUX_TMPDIR=$T
trap 'TMUX_TMPDIR=$T tmux kill-server 2>/dev/null || true; rm -rf "$T"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }
mkdir -p "$T/v/1" "$T/v/2" "$T/tr" "$T/bin"
cp /bin/sleep "$T/v/1/claude"; cp /bin/sleep "$T/v/2/claude"
export OPS_REFRESH_SESSION=t OPS_REFRESH_LINK="$T/bin/claude" OPS_REFRESH_TRANSCRIPTS="$T/tr" OPS_REFRESH_IDLE_MIN=15
export OPS_REFRESH_RESUME_FILE="$T/resume" OPS_REFRESH_DEFER_FILE="$T/defer" OPS_REFRESH_NOTIFY="$T/notify"
printf '#!/bin/sh\necho "$1 | $2" >> "%s/notes"\n' "$T" > "$T/notify"; chmod +x "$T/notify"
S=$R/device/edge/debian/ops-refresh
start() { tmux new-session -d -s t "exec $T/v/1/claude 600"; sleep 0.5; }
has() { tmux has-session -t t 2>/dev/null; }

# 1. same version: nothing
ln -sf "$T/v/1/claude" "$T/bin/claude"; start
OPS_REFRESH_NOW=$(( $(date +%s) + 7200 )) sh "$S" >"$T/o" || fail "run 1"
has || fail "same version must keep the session"

# 2. new version, session active (fresh transcript): kept
ln -sf "$T/v/2/claude" "$T/bin/claude"; : > "$T/tr/a.jsonl"
sh "$S" >"$T/o" || fail "run 2"
has || fail "active session must be kept"
grep -q "retry next round" "$T/o" || fail "active: no log line"
sh "$S" >"$T/o"
[ "$(grep -c "in attesa" "$T/notes")" = 1 ] || fail "deferred notice must be sent once"
grep -q "1 -> 2" "$T/notes" || fail "deferred notice lacks versions"

# 3. new version, idle: killed, logged old -> new
OPS_REFRESH_NOW=$(( $(date +%s) + 7200 )) sh "$S" >"$T/o" || fail "run 3"
has && fail "idle session must be killed"
grep -q "v/1/claude -> $T/v/2/claude" "$T/o" || fail "no old -> new log"
[ ! -e "$T/resume" ] || fail "empty transcript: no resume id"
grep -q "nessuna chat" "$T/notes" || fail "no notice for fresh session"

# 3b. conversation in progress: id saved, notice says same chat
rm -f "$T/notes"; ln -sf "$T/v/1/claude" "$T/bin/claude"; start; ln -sf "$T/v/2/claude" "$T/bin/claude"
echo x > "$T/tr/abc-123.jsonl"
OPS_REFRESH_NOW=$(( $(date +%s) + 7200 )) sh "$S" >"$T/o" || fail "run 3b"
has && fail "3b: must be killed"
[ "$(cat "$T/resume")" = abc-123 ] || fail "3b: resume id not saved"
grep -q "stessa chat ripresa" "$T/notes" || fail "3b: no same-chat notice"

# 4. no session: silent no-op
sh "$S" >"$T/o" || fail "run 4"; [ ! -s "$T/o" ] || fail "no session must print nothing"
echo "ok ops-refresh"
