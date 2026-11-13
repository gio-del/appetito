#!/bin/sh
# Test of ops-suggest's kept runs and Log (issue 107): a (replayed) Claude run is kept gzipped in
# $HOME/.local/state/ops-suggest/runs/ (dir 700) and its redacted Log is written to suggest.json (640),
# with the secret in Claude's text hidden and no tool output. Throwaway HOME, no Claude.
# From the repo root: device/edge/tests/ops-suggest-log.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
mkdir -p "$t/.local/bin" "$t/bin" "$t/projects/sp" "$t/home-server/issues/open" "$t/home-server/issues/done" "$t/home-server/issues/proposed"
ln -s "$R/device/edge/debian/ops-suggest-index" "$t/bin/"
cat > "$t/.local/bin/hs-setting" <<'EOF2'
#!/bin/sh
case $1 in HS_SUGGEST_ENABLED) echo 1 ;; HS_SUGGEST_HOUR) echo 0 ;; HS_SUGGEST_QUOTA_MAX) echo 100 ;;
HS_SUGGEST_PENDING_MAX) echo 10 ;; HS_SUGGEST_MAX) echo 3 ;; *) exit 1 ;; esac
EOF2
printf '#!/bin/sh\necho "sp - - active github -"\n' > "$t/projects.sh"
chmod +x "$t/.local/bin/hs-setting" "$t/projects.sh"
git -C "$t/projects/sp" init -q
git -C "$t/projects/sp" -c user.email=t@t -c user.name=t commit -qm init --allow-empty
TOK=sk-ant-oat01-FAKEFAKEFAKE1234567890abcdefXYZ
{
	echo '{"type":"assistant","message":{"content":[{"type":"text","text":"Leggo con '"$TOK"'"}]}}'
	echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"README.md"}}]}}'
	echo '{"type":"user","message":{"content":[{"type":"tool_result","content":"SECRET-OUTPUT"}]}}'
	echo '{"type":"result","subtype":"success","is_error":false,"result":"{\"proposals\":[],\"preferences\":\"\"}"}'
} > "$t/replay.jsonl"
echo '{"projects":{}}' > "$t/pi.json"
PATH=$t/.local/bin:$PATH HOME=$t HS_SUGGEST_REPLAY=$t/replay.jsonl HS_SUGGEST_PROJECTS=$t/projects.sh HS_PROJECTS_ISSUES=$t/pi.json \
	HS_SUGGEST_STATUS=$t/suggest.json HS_SUGGEST_AUTO_LOCK=$t/auto.lock HS_SUGGEST_LOG=$t/slog.json \
	HS_SUGGEST_LOGGER="$R/device/edge/debian/ops-auto-log" "$R/device/edge/debian/ops-suggest" --now > /dev/null
fail=0
check() { [ "$2" = "$3" ] || { echo "FAIL: $1: got '$2', want '$3'"; fail=1; }; }
runs=$t/.local/state/ops-suggest/runs
check "run kept" "$(ls "$runs" | grep -c 'sp\.jsonl\.gz$')" 1
check "runs dir 700" "$(stat -c %a "$runs")" 700
check "run readable" "$(zcat "$runs"/*-sp.jsonl.gz | grep -c '"type":"result"')" 1
check "log mode" "$(stat -c %a "$t/slog.json")" 640
check "log project id" "$(jq -r .id "$t/slog.json")" sp
check "log entries" "$(jq -r '[.entries[].k] | join(",")' "$t/slog.json")" "text,tool"
check "token hidden" "$(grep -c FAKEFAKE "$t/slog.json" || true)" 0
check "no tool output" "$(grep -c SECRET-OUTPUT "$t/slog.json" || true)" 0
# No Read/Grep/Glob in the stream: answer discarded (issue 306)
grep -v '"name":"Read"' "$t/replay.jsonl" > "$t/replay2.jsonl"
out=$(PATH=$t/.local/bin:$PATH HOME=$t HS_SUGGEST_REPLAY=$t/replay2.jsonl HS_SUGGEST_PROJECTS=$t/projects.sh HS_PROJECTS_ISSUES=$t/pi.json \
	HS_SUGGEST_STATUS=$t/suggest.json HS_SUGGEST_AUTO_LOCK=$t/auto.lock HS_SUGGEST_LOG=$t/slog.json \
	HS_SUGGEST_LOGGER="$R/device/edge/debian/ops-auto-log" "$R/device/edge/debian/ops-suggest" --dry-run)
check "no reads: discarded" "$(printf "%s" "$out" | grep -c "nessuna lettura")" 1

[ "$fail" = 0 ] && echo "ok: ops-suggest log"
exit $fail
