#!/bin/sh
# Regression test for issue 450: the tmux tests must not touch the tmux server they are launched from.
# Inside the ops session $TMUX is set and wins over TMUX_TMPDIR, so the tests' sessions and their final
# kill-server hit the real server and closed the ops session (2026-11-08, twice). Here a "canary" server on a
# private socket plays the ops session: $TMUX points at it while the tmux tests run, and it must survive. Offline.
# From the repo root: device/edge/tests/tmux-isolation.sh
set -eu
R=$(cd "$(dirname "$0")/../../.." && pwd)
command -v tmux >/dev/null || { echo "SKIP: no tmux"; exit 0; }
C=$(mktemp -d); trap 'tmux -S "$C/sock" kill-server 2>/dev/null || true; rm -rf "$C"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }
tmux -S "$C/sock" new-session -d -s canary "exec sleep 600"
pid=$(tmux -S "$C/sock" display-message -p -t canary '#{pid}')
for t in brain-refresh ops-refresh; do
	TMUX="$C/sock,$pid,0" sh "$R/device/edge/tests/$t.sh" > "$C/out" 2>&1 || fail "$t inside tmux: $(tail -1 "$C/out")"
	tmux -S "$C/sock" has-session -t canary 2>/dev/null || fail "$t closed the tmux session it was launched from"
	tmux -S "$C/sock" has-session -t t 2>/dev/null && fail "$t left its session on the outer server"
done
echo "ok tmux-isolation"
