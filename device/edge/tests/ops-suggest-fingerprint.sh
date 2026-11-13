#!/bin/sh
# Test of ops-suggest's "niente di nuovo" skip (issue 119), in cron mode with HS_SUGGEST_REPLAY
# (no Claude) and a throwaway HOME: a second run with the same inputs doesn't reach Claude, logs and
# shows "niente di nuovo" and counts as the day's run; an issue-only commit that changes no title
# still skips; a code commit or a new issue runs again.
# From the repo root, on the Edge (needs /etc/home-server.env and /opt/hs-tracker/issues.js):
# device/edge/tests/ops-suggest-fingerprint.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
mkdir -p "$t/.local/bin" "$t/bin" "$t/projects" "$t/home-server/issues/open" "$t/home-server/issues/done"
ln -s "$R/device/edge/debian/ops-suggest-index" "$t/bin/"
cat > "$t/.local/bin/hs-setting" <<'EOF'
#!/bin/sh
case $1 in HS_SUGGEST_ENABLED) echo 1 ;; HS_SUGGEST_HOUR) echo "${T_HOUR:-0}" ;; HS_SUGGEST_HOUR_EVENING) echo "${T_EVE:-no}" ;; HS_SUGGEST_QUOTA_MAX) echo 100 ;;
HS_SUGGEST_PENDING_MAX) echo 10 ;; HS_SUGGEST_MAX) echo 3 ;; *) exit 1 ;; esac
EOF
printf '#!/bin/sh\necho "hs - - active issues -"\n' > "$t/projects.sh"
chmod +x "$t/.local/bin/hs-setting" "$t/projects.sh"
ln -s "$t/home-server" "$t/projects/hs"
cd "$t/home-server"
git init -q && git config user.email t@t && git config user.name t
printf '# Prima issue\n\nStatus: todo\n' > issues/open/001-a.md
echo x > code.sh
git add -A && git commit -qm init
{ echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"README.md"}}]}}'; echo '{"type":"result","subtype":"success","is_error":false,"result":"{\"proposals\":[],\"preferences\":\"p\"}"}'; } > "$t/replay.jsonl"

ST=$t/.local/state/ops-suggest
run() { rm -f "$ST/last-day"; HOME=$t HS_SUGGEST_REPLAY=$t/replay.jsonl HS_SUGGEST_PROJECTS=$t/projects.sh \
	HS_SUGGEST_STATUS=$t/suggest.json HS_SUGGEST_AUTO_LOCK=$t/auto.lock "$R/device/edge/debian/ops-suggest"; }
claude_runs() { grep -c 'hs: N=3, 0 valid' "$ST/ops-suggest.log" || true; }
fail() { echo "FAIL: $*"; cat "$ST/ops-suggest.log"; exit 1; }

run; [ "$(claude_runs)" = 1 ] || fail "first run"
[ "$(jq -r .outcome "$t/suggest.json")" = "0 nuove proposte" ] || fail "first outcome"
run; [ "$(claude_runs)" = 1 ] || fail "same inputs reached Claude"
[ "$(jq -r .outcome "$t/suggest.json")" = "niente di nuovo dall'ultimo giro" ] || fail "skip outcome"
[ "$(cat "$ST/last-day")" = "$(date +%F)" ] || fail "skip not counted as the day's run"
printf '# Prima issue\n\nStatus: in-progress\n\n## Note\nx\n' > issues/open/001-a.md
git commit -qam "issue only"
run; [ "$(claude_runs)" = 1 ] || fail "issue-only commit reached Claude"
echo y > code.sh && git commit -qam code
run; [ "$(claude_runs)" = 2 ] || fail "code commit skipped"
run; [ "$(claude_runs)" = 2 ] || fail "second same run"
printf '# Seconda issue\n\nStatus: todo\n' > issues/open/002-b.md
run; [ "$(claude_runs)" = 3 ] || fail "new issue skipped"
# Two slots a day (issue 272): evening 19, now 20; each slot has its own "last" file, "niente di nuovo" in each.
srun() { HOME=$t T_HOUR=8 T_EVE=19 HS_SUGGEST_NOW_HOUR=$1 HS_SUGGEST_REPLAY=$t/replay.jsonl HS_SUGGEST_PROJECTS=$t/projects.sh \
	HS_SUGGEST_STATUS=$t/suggest.json HS_SUGGEST_AUTO_LOCK=$t/auto.lock "$R/device/edge/debian/ops-suggest"; }
echo z > code.sh && git commit -qam code2
rm -f "$ST/last-day" "$ST/last-day-evening"
srun 7; [ "$(claude_runs)" = 4 ] && fail "ran before the morning hour" || true
[ ! -e "$ST/last-day" ] || fail "morning counted before its hour"
srun 20; [ "$(claude_runs)" = 4 ] || fail "evening run did not happen"
[ "$(cat "$ST/last-day-evening")" = "$(date +%F)" ] || fail "evening not marked"
[ ! -e "$ST/last-day" ] || fail "evening marked the morning"
srun 20; [ "$(jq -r .slots.evening "$t/suggest.json")" = "$(date +%F)" ] || fail "slots in suggest.json"
srun 21; [ "$(claude_runs)" = 4 ] || fail "morning after evening reached Claude with same inputs"
[ "$(cat "$ST/last-day")" = "$(date +%F)" ] || fail "morning skip not counted"
echo "ok: ops-suggest fingerprint"
