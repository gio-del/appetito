#!/bin/sh
# Test of issues-triage (issue 478): a replayed AI answer moves only the "non serve" To do issues to backlog
# with a (sistema) comment; Owner-confirmed (and children), monitor, advisories, in-progress, backlog stay;
# "serve" ones are not asked again; invalid answers change nothing. Throwaway HOME, no AI.
# From the repo root: device/edge/tests/issues-triage.sh
set -eu
R=$(pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/.local/bin" "$t/repo/issues/open" "$t/repo/issues/done"
printf '#!/bin/sh\ncase $1 in HS_SUGGEST_QUOTA_MAX) echo 100 ;; *) exit 1 ;; esac\n' > "$t/.local/bin/hs-setting"; chmod +x "$t/.local/bin/hs-setting"
echo "Direzione di prova" > "$t/repo/DIREZIONE.md"
mk() { printf '# %s\n\nOpened: 2026-11-01\nBlocked on: -\nStatus: %s\n%s\n\nCorpo.\n' "$2" "$3" "${4:-}" > "$t/repo/issues/open/$1.md"; }
mk 001-inutile "Cosa inutile" todo
mk 002-utile "Cosa utile" todo
mk 003-scelta "Scelta dall owner" todo "Owner-confirmed: 2026-11-09"
mk 004-figlia "Figlia della scelta" todo "Parent: 003"
mk 005-monitor "Monitor" todo "Labels: monitor"
mk 006-avviso "Avviso" todo "Fingerprint: advisory-x"
mk 007-corso "In corso" in-progress
mk 008-backlog "Già backlog" backlog
mk 009-fuori "Altra inutile" todo
ans='{"issues":[{"n":"001","serve":false,"motivo":"Aggiunge peso."},{"n":"002","serve":true,"motivo":"Serve."},{"n":"003","serve":false,"motivo":"x"},{"n":"007","serve":false,"motivo":"x"},{"n":"999","serve":false,"motivo":"x"},{"n":"009","serve":false,"motivo":""}]}'
jq -nc --arg r "$ans" '{type:"result",result:$r}' > "$t/replay.jsonl"
run() { PATH=$t/.local/bin:$PATH HOME=$t HS_TRIAGE_REPO=$t/repo HS_ISSUES_JS=$R/device/edge/tracker/issues.js HS_TRIAGE_REPLAY=$t/replay.jsonl \
	HS_TRIAGE_AUTO_LOCK=$t/auto.lock HS_AI_RUN=/bin/false "$R/device/edge/debian/issues-triage" "$@"; }
fail=0
check() { [ "$2" = "$3" ] || { echo "FAIL: $1: got '$2', want '$3'"; fail=1; }; }
st() { sed -n 's/^Status: //p' "$t/repo/issues/open/$1.md"; }
check "candidates exclude protected" "$(ISSUES_REPO=$t/repo node "$R/device/edge/tracker/issues.js" --triage-candidates | jq -r '[.[].n] | join(",")')" "001,002,009"
run --dry-run > "$t/dry.txt"
check "dry: nothing moved" "$(st 001-inutile)" todo
check "dry: says it" "$(grep -c 'sposterei #001' "$t/dry.txt")" 1
run
check "moved" "$(st 001-inutile)" backlog
check "comment" "$(grep -c '(sistema)' "$t/repo/issues/open/001-inutile.md")" 1
check "serve stays" "$(st 002-utile)" todo
check "confirmed stays" "$(st 003-scelta)" todo
check "in-progress stays" "$(st 007-corso)" in-progress
check "invalid reason: stays" "$(st 009-fuori)" todo
check "moved.log" "$(grep -c ' 001 Cosa inutile|Aggiunge peso' "$t/.local/state/issues-triage/moved.log")" 1
check "serve remembered" "$(cat "$t/.local/state/issues-triage/seen")" 002
[ "$fail" = 0 ] || exit 1
echo "ok: issues-triage"
