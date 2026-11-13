#!/bin/sh
# Test of ops-suggest-signals (issue 128) on a synthetic claude-usage: last 7 days vs the 7 before,
# thresholds (over or not), stable ids, only numbers/ids/repo paths (no issue files, no paths outside
# the repo), ≤ 3 KB; and of ops-suggest's validator with HS_SUGGEST_REPLAY (--dry-run): an
# optimization/quality proposal passes only if it cites a signal over threshold.
# From the repo root, on the Edge (needs /etc/home-server.env and /opt/hs-tracker/issues.js):
# device/edge/tests/ops-suggest-signals.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }

# claude-usage stub: --runs → runs, otherwise the 7-day aggregate with its Read paths.
run() { # start issue attempt outcome cost prefix denied outKB lettura
	printf '{"start":"%s","issue":"%s","attempt":%s,"outcome":"%s","cost":%s,"prefixTokens":%s,"denied":%s,"deniedTools":{"Bash":%s},"deniedBash":{"sudo":%s},"toolOutputBytes":{"Bash":%s},"bash":{"lettura":%s}}' \
		"$1" "$2" "$3" "$4" "$5" "$6" "$7" "$7" "$7" $(($8 * 1024)) "$9"; }
{
	printf '{"runs":['
	run "2026-10-05 10:00" 101 1 chiusa 2 20000 0 10 5; printf ,
	run "2026-10-06 10:00" 102 1 chiusa 2 20000 0 10 5; printf ,
	run "2026-10-15 10:00" 103 1 chiusa 4 30000 2 40 20; printf ,
	run "2026-10-16 10:00" 103 2 consegnata 3 30000 1 40 20; printf ,
	run "2026-10-17 10:00" 104 3 chiusa 3 30000 0 40 20; printf ,
	run "2026-10-18 10:00" 105 1 errore 1 30000 0 40 20
	printf ']}\n'
} > "$t/runs.json"
cat > "$t/agg.json" <<EOF
{"jobs":{"ops-auto":{"topReadFiles":[{"file":"$t/repo/device/big","bytes":40960},{"file":"$t/repo/issues/open/1-x.md","bytes":9999},{"file":"/etc/passwd","bytes":9999}]}}}
EOF
printf '#!/bin/sh\ncase "$*" in *--runs*) cat %s/runs.json ;; *) cat %s/agg.json ;; esac\n' "$t" "$t" > "$t/usage"
chmod +x "$t/usage"
printf '{"window":"seven_day","closed":true,"unusedPct":70,"resetsAt":"2026-10-14T10:00:00.000Z"}\n' > "$t/windows.jsonl"
# Maintenance: hs-monitor issue headers (a Fingerprint after the header doesn't count), pending
# updates (only plain app names), a revert in the last 7 days.
mkdir -p "$t/repo/issues/open" "$t/repo/issues/done"
issue() { printf '# x\n\nOpened: %s\nStatus: todo\nFingerprint: %s\n\n## Comments\nFingerprint: job-fake\n' "$3" "$4" > "$t/repo/issues/$1/$2.md"; }
issue done 010-a 2026-10-10 job-selftest; issue done 011-b 2026-10-16 job-selftest; issue open 012-c 2026-10-17 vault-sync-d23aeub
issue done 013-d 2026-10-12 lint-no-status-001; issue done 014-e 2026-10-13 lint-no-status-002; issue done 015-f 2026-10-14 lint-hidden-work-003
issue done 016-g 2026-09-01 lint-no-status-009; issue open 017-h 2026-10-09 advisory-debian-cve-1-caddy; issue open 018-i 2026-10-17 advisory-go-2-x
# Risk-accepted (issue 297): valid -> not counted; expired, over 90 days, malformed, or a fix exists -> counted
risk() { printf '# x\n\nOpened: 2026-10-01\nBlocked on: %s\nStatus: todo\nRisk-accepted: %s\nFingerprint: %s\n\n## Comments\n' "$4" "$3" "$5" > "$t/repo/issues/open/$1-$2.md"; }
NF='user (avviso senza versione corretta)'
risk 019 ok 2026-11-30 "$NF" advisory-a-1; risk 020 old 2026-10-01 "$NF" advisory-b-1; risk 021 far 2027-06-01 "$NF" advisory-c-1
risk 022 bad 2026-13-45 "$NF" advisory-d-1; risk 023 fixed 2026-11-30 - advisory-e-1
(cd "$t/repo" && git init -q && git config user.email t@t && git config user.name t && git commit -q --allow-empty -m x && git commit -q --allow-empty -m 'Revert "x"')
printf '{"apps":[{"app":"homepage","published":"2026-10-05T10:00:00Z"},{"app":"Bad App","published":"2026-10-01T00:00:00Z"},{"app":"bw-cli","published":"2026-10-15T10:00:00Z"}]}\n' > "$t/pending.json"
printf "2026-10-01 09:00:00 failed install\n2026-10-15 09:00:00 failed check\n2026-10-15 09:05:00 ok\n2026-10-16 09:00:00 failed install: caddy\n2026-10-17 09:00:00 failed check: test:foo.sh\n2026-10-17 09:10:00 failed check: test:foo.sh\ngarbage line\n" > "$t/deploy.log"
HOME=$t HS_REPO=$t/repo HS_SIGNALS_USAGE=$t/usage HS_SIGNALS_NOW=2026-10-18 CLAUDE_USAGE_WINDOWS=$t/windows.jsonl HS_SIGNALS_PENDING=$t/pending.json HS_SIGNALS_DEPLOYLOG=$t/deploy.log \
	node "$R/device/edge/debian/ops-suggest-signals" > "$t/s.json"
s() { jq -r "$1" "$t/s.json"; }
k() { s ".[] | select(.id == \"$1\") | $2"; }
check "ids, stable order" "$(s '[.[].id] | join(" ")')" "sig-cost-7d sig-prefix sig-retries sig-handed-over sig-denied sig-errors sig-context-size sig-explore sig-monitor-repeat sig-lint-repeat sig-advisories-open sig-apps-behind sig-reverts sig-deploy-failed sig-quota-unused"
# shellcheck disable=SC2016
{
check "monitor kind repeated in 14 days" "$(k sig-monitor-repeat '"\(.kinds14d | map("\(.kind)=\(.count)") | join(",")) \(.over)"')" "job-selftest=2,vault-sync=1 true"
check "lint kinds, older than 14 days ignored" "$(k sig-lint-repeat '"\(.kinds14d | map("\(.kind)=\(.count)") | join(",")) \(.over)"')" "lint-no-status=2,lint-hidden-work=1 false"
check "open advisories, oldest age" "$(k sig-advisories-open '"\(.count) \(.oldestDays) \(.issues | join(",")) \(.over)"')" "6 17 017,018,020,021,022,023 true"
check "apps behind, plain names only" "$(k sig-apps-behind '"\(.apps | map("\(.app)=\(.days)") | join(",")) \(.over)"')" "homepage=12,bw-cli=2 true"
check "reverts in 7 days" "$(k sig-reverts '"\(.count) \(.over)"')" "1 true"
check "deploys failed in 7 days" "$(k sig-deploy-failed '"\(.failedCheck) \(.failedInstall) \(.deploys) \(.over)"')" "3 1 5 true"
check "byReason, old lines without a reason" "$(k sig-deploy-failed '.byReason | to_entries | map("\(.key)=\(.value)") | join(",")')" "check: ?=1,install: caddy=1,check: test:foo.sh=2"
}
check "cost 7d vs previous, over" "$(s '.[0] | "\(.usd) \(.prevUsd) \(.runs) \(.over)"')" "11 4 4 true"
check "prefix over 24k" "$(s '.[1] | "\(.avgPrefixTokens) \(.prevAvgPrefixTokens) \(.over)"')" "30000 20000 true"
check "retried issues (attempt >= 2)" "$(s '.[2] | "\(.issues | join(",")) \(.over)"')" "103,104 true"
check "handed over" "$(s '.[3].issues | join(",")')" "103"
check "denied at threshold" "$(s '.[4] | "\(.count) \(.over) \(.byTool.Bash)"')" "3 true 3"
check "denied byCommand" "$(s '.[4].byCommand | to_entries | map("\(.key)=\(.value)") | join(",")')" "sudo=3"
check "errors under threshold" "$(s '.[5] | "\(.count) \(.over)"')" "1 false"
check "context size, repo paths only" "$(s '.[6] | "\(.toolOutputKBPerRun) \(.over) \(.topReadFiles | map(.file) | join(","))"')" "40 true device/big"
check "explore per run" "$(s '.[7] | "\(.readCommandsPerRun) \(.over)"')" "20 true"
check "unused quota at the last reset" "$(k sig-quota-unused '"\(.unusedPct) \(.resetsAt) \(.over)"')" "70 2026-10-14 true"
check "size ≤ 3 KB" "$([ "$(wc -c < "$t/s.json")" -le 3072 ] && echo y)" y
check "no paths outside the repo" "$(grep -c "$t\|passwd\|issues/" "$t/s.json" || true)" 0
# --card (issue 298): same signals in a file, nothing on stdout
HOME=$t HS_SIGNALS_NOW=2026-10-19 HS_REPO=$t/repo HS_SIGNALS_PENDING=$t/none HS_SIGNALS_DEPLOYLOG=$t/none HS_SIGNALS_USAGE=$t/usage CLAUDE_USAGE_WINDOWS=$t/windows.jsonl HS_SIGNALS_CARD=$t/card/signals.json node "$R/device/edge/debian/ops-suggest-signals" --card > "$t/card.out"
check "card: schema" "$(jq -r '[.v, (.generated|length), (.signals|length>0), (.signals|map(.id)|index("sig-prefix")!=null)]|join(",")' "$t/card/signals.json")" "1,24,true,true"
check "card: nothing on stdout" "$(wc -c < "$t/card.out" | tr -d " ")" 0
printf '#!/bin/sh\nexit 1\n' > "$t/broken"; chmod +x "$t/broken"
check "no usage, issues or updates: empty array" "$(HOME=$t HS_REPO=$t/none HS_SIGNALS_PENDING=$t/none HS_SIGNALS_DEPLOYLOG=$t/none HS_SIGNALS_USAGE=$t/broken CLAUDE_USAGE_WINDOWS=$t/none node "$R/device/edge/debian/ops-suggest-signals")" "[]"

# Validator: optimization/quality need a signal over threshold.
mkdir -p "$t/.local/bin" "$t/bin" "$t/projects" "$t/home-server/issues/open" "$t/home-server/issues/done"
ln -s "$R/device/edge/debian/ops-suggest-index" "$t/bin/"
cat > "$t/.local/bin/hs-setting" <<'EOF'
#!/bin/sh
case $1 in HS_SUGGEST_QUOTA_MAX) echo 100 ;; HS_SUGGEST_PENDING_MAX) echo 10 ;; HS_SUGGEST_MAX) echo 5 ;; *) exit 1 ;; esac
EOF
printf '#!/bin/sh\necho "hs - - active issues -"\n' > "$t/projects.sh"
printf '#!/bin/sh\necho %s\n' "'[{\"id\":\"sig-prefix\",\"over\":true,\"avgPrefixTokens\":37000},{\"id\":\"sig-denied\",\"over\":false,\"count\":1}]'" > "$t/signals"
chmod +x "$t/.local/bin/hs-setting" "$t/projects.sh" "$t/signals"
ln -s "$t/home-server" "$t/projects/hs"
(cd "$t/home-server" && git init -q && git config user.email t@t && git config user.name t && echo x > a && git add -A && git commit -qm i)
body() { printf '## Problema\n%s\n\n## Proposta\nx\n\n## Criteri di accettazione\n- x\n\n## Piano\nx\n\n## Esecuzione\n- [ ] x\n' "$1"; }
jq -n --arg a "$(body 'sig-prefix: 37000 token')" --arg b "$(body 'sig-denied: 1')" --arg c "$(body 'niente numeri')" --arg d "$(body 'x')" \
	'{proposals: [{title: "Prefisso più corto", kind: "optimization", mode: "afk", body: $a},
		{title: "Meno azioni bloccate", kind: "quality", mode: "afk", body: $b},
		{title: "Ottimizzazione inventata", kind: "optimization", mode: "afk", body: $c},
		{title: "Nuova funzione qualsiasi", kind: "feature", mode: "afk", body: $d}], preferences: "p"}
	| {type: "result", subtype: "success", is_error: false, result: tojson}' -c > "$t/replay.tail"; { echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"README.md"}}]}}'; cat "$t/replay.tail"; } > "$t/replay.jsonl"
HOME=$t HS_SUGGEST_REPLAY=$t/replay.jsonl HS_SUGGEST_PROJECTS=$t/projects.sh HS_SUGGEST_SIGNALS=$t/signals \
	HS_SUGGEST_STATUS=$t/suggest.json HS_SUGGEST_AUTO_LOCK=$t/auto.lock "$R/device/edge/debian/ops-suggest" --dry-run > "$t/out"
check "valid proposals" "$(grep '^=== ' "$t/out" | grep -v preferences | cut -d'[' -f1 | sed 's/^=== //; s/ $//' | tr '\n' '|')" "Prefisso più corto|Nuova funzione qualsiasi|"
check "dropped without a signal over threshold" "$(grep -c 'dropped no signal' "$t/out")" 2
[ "$fail" = 0 ] || { cat "$t/out"; exit 1; }
echo "ok: ops-suggest-signals"
