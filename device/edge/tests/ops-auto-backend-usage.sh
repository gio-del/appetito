#!/bin/sh
# Consumption per backend (issue 253): a round of ops-auto appends one numbers-only line (backend, issue,
# tokens, cost) to backend-usage.jsonl and ops-auto-card sums the last 7 days per backend into the
# detail's `backends`. Temp HOME/repo, stub claude. From the repo root: device/edge/tests/ops-auto-backend-usage.sh
set -eu
R=$(pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
H=$t/home
mkdir -p "$H/bin" "$H/.local/bin" "$H/home-server/issues/open" "$H/home-server/issues/done"
cp "$R/device/edge/debian/ai-run" "$R/device/edge/debian/ops-auto" "$R/device/edge/debian/ops-auto-request" "$H/bin/"
printf '#!/bin/sh\n' > "$H/bin/ops-auto-card"
printf '#!/bin/sh\ncase $1 in HS_AUTO_QUOTA_MAX) echo 50 ;; HS_AUTO_PAUSE) echo 0 ;; HS_AUTO_MAX_PER_RUN) echo 1 ;; HS_AI_BACKEND) echo headless ;; *) echo default ;; esac\n' > "$H/.local/bin/hs-setting"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/hs-runlog"
printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/issues-context"
printf '#!/bin/sh\n' > "$H/.local/bin/hs-run"
cat > "$H/.local/bin/claude" <<'EOS'
#!/bin/sh
echo '{"type":"result","subtype":"success","is_error":false,"num_turns":4,"total_cost_usd":0.25,"usage":{"input_tokens":120,"output_tokens":800,"cache_read_input_tokens":5000,"cache_creation_input_tokens":300},"result":"SECRET-TEXT"}'
EOS
chmod +x "$H/bin/"* "$H/.local/bin/"*
printf '# Prova\n\nOpened: 2026-10-27\nBlocked on: -\nStatus: todo\n' > "$H/home-server/issues/open/019-prova.md"
cd "$H/home-server"; git init -q -b main && git config user.name t && git config user.email t@t
git add -A && git commit -qm init
export HS_QUEUE_PROJECTS_JSON= HOME="$H" HS_AUTO_QUIET=-2000000000 HS_AUTO_REQUEST="$t/none.json" HS_AUTO_DETAIL="$t/detail.json" HS_ISSUES_JS="$R/device/edge/tracker/issues.js"
"$H/bin/ops-auto" > /dev/null 2>&1 || true
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
F=$H/.local/state/ops-auto/backend-usage.jsonl
check "one line written" "$(wc -l < "$F" 2>/dev/null || echo 0)" 1
check "numbers and backend" "$(jq -c '[.backend, .issue, .turns, .cost, .in, .out, .cacheRead, .cacheWrite]' "$F" 2>/dev/null)" '["headless","019",4,0.25,120,800,5000,300]'
check "no text in the record" "$(grep -c SECRET "$F" || true)" 0
# an old line (older than 7 days) and an invalid backend name are not counted
printf '{"t":1,"backend":"headless","issue":"1","turns":9,"cost":9,"in":9,"out":9,"cacheRead":9,"cacheWrite":9}\n{"t":%s,"backend":"A b","cost":5}\n' "$(date +%s)" >> "$F"
cp "$R/device/edge/debian/ops-auto-card" "$t/card"
rm -f "$H/bin/ops-auto-card"; cp "$t/card" "$H/bin/ops-auto-card"; chmod +x "$H/bin/ops-auto-card"
mkdir -p "$t/edge"; export HS_AUTO_CARD="$t/card.json"
"$H/bin/ops-auto-card" > /dev/null 2>&1 || true
check "card sums the last 7 days" "$(jq -c '.backends' "$t/detail.json" 2>/dev/null)" '{"days":7,"by":{"headless":{"runs":1,"turns":4,"cost":0.25,"in":120,"out":800,"cacheRead":5000,"cacheWrite":300}}}'
exit $fail
