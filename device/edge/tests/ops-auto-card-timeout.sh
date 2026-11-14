#!/bin/sh
# Issue 580: "Giri recenti" shows a run killed by the timeout (rc 124) as `timeout`, not `error`;
# a real failure (rc 1) stays `error`. Real ops-auto-card on a fake log in a temp HOME.
# From the repo root: device/edge/tests/ops-auto-card-timeout.sh
set -eu
R=$(pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
H=$t/home
mkdir -p "$H/home-server/issues/open" "$H/home-server/issues/done" "$H/.local/state/ops-auto" "$t/out"
printf '# Prova\n\nOpened: 2026-11-13\nBlocked on: -\nStatus: todo\n' > "$H/home-server/issues/open/019-prova.md"
cat > "$H/.local/state/ops-auto/ops-auto.log" <<'EOL'
2026-11-13 17:07:00 #19: run 1 (019-prova.md)
2026-11-13 18:07:00 #19: in corso rc=124 {"num_turns":3}
2026-11-13 18:37:00 #19: run 2 (019-prova.md)
2026-11-13 18:38:00 #19: in corso rc=1 {"num_turns":1}
2026-11-13 19:07:00 #19: run 3 (019-prova.md)
2026-11-13 19:08:00 #19: in corso rc=0 {"num_turns":1}
EOL
(cd "$H/home-server"; HOME="$H" HS_QUEUE_PROJECTS_JSON= HS_AUTO_CARD="$t/out/auto.json" HS_AUTO_DETAIL="$t/out/detail.json" HS_AUTO_LOG="$t/out/run.json" node "$R/device/edge/debian/ops-auto-card" > /dev/null 2>&1 || true)
got=$(jq -r '[.history[].outcome] | join(",")' "$t/out/detail.json")
got2=$(jq -r '[.rounds[].issues[].outcome] | join(",")' "$t/out/detail.json")
fail=0
[ "$got" = "timeout,error,partial" ] && echo "ok   history" || { echo "FAIL history: $got"; fail=1; }
[ "$got2" = "timeout,error,partial" ] && echo "ok   rounds" || { echo "FAIL rounds: $got2"; fail=1; }
exit $fail
