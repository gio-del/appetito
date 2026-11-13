#!/bin/sh
# Test of attriti-signals (issue 468) on synthetic issues, claude-usage and sessions.
# From the repo root: device/edge/tests/attriti-signals.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }

mkdir -p "$t/repo/issues/open" "$t/repo/issues/done" "$t/sess"
cat > "$t/repo/issues/open/010-a.md" <<'EOF'
# Serve il login

Opened: 2026-10-20
Blocked on: user (login scaduto)
Status: todo

## Esecuzione
- [ ] (HITL) Rifai il login (account)
- [x] (HITL, non più necessario: #9) Rifai il login anche qui (account)
- [x] (HITL) Scegli l'opzione (scelta)

## Per te (2026-11-01)
Fai il login.

## Comments
### 2026-11-03 10:00 (owner)
Perché di nuovo il login?
EOF
cat > "$t/repo/issues/done/011-b.md" <<'EOF'
# Chiusa di recente

Opened: 2026-11-01
Closed: 2026-11-05
Blocked on: -
Fingerprint: job-x-1

- [x] (HITL) Vecchia domanda (scelta)
EOF
cat > "$t/repo/issues/done/012-c.md" <<'EOF'
# Vecchia

Opened: 2026-09-01
Closed: 2026-09-02
Blocked on: -
Fingerprint: job-x-2

- [x] (HITL) Troppo vecchia (scelta)
EOF
printf '# d\n\nOpened: 2026-11-06\nBlocked on: -\nFingerprint: job-x-3\n' > "$t/repo/issues/open/013-d.md"
printf '{"runs":[{"start":"2026-11-02 10:00","issue":"10","attempt":3,"outcome":"consegnata"},{"start":"2026-11-03 10:00","issue":"11","attempt":1,"outcome":"chiusa"},{"start":"2026-11-04 10:00","issue":"12","attempt":1,"outcome":"errore"}]}\n' > "$t/runs.json"
printf '#!/bin/sh\ncat %s/runs.json\n' "$t" > "$t/usage"; chmod +x "$t/usage"
{
	printf '%s\n' '{"type":"user","timestamp":"2026-11-08T10:00:00Z","message":{"role":"user","content":"Il digest non è arrivata ancora, perché?"}}'
	printf '%s\n' '{"type":"user","timestamp":"2026-11-08T11:00:00Z","message":{"role":"user","content":[{"type":"tool_result","content":"perché di nuovo"}]}}'
	printf '%s\n' '{"type":"user","timestamp":"2026-11-08T12:00:00Z","message":{"role":"user","content":"tutto bene"}}'
} > "$t/sess/a.jsonl"

mkdir -p "$t/repo/device/edge/debian"
printf "# c\nGitHub token | 2026-11-20 | rinnova\n" > "$t/repo/device/edge/debian/credentials"
printf "# c\nmail | salta il weekend | notifica\nx | cambia qualcosa | \n" > "$t/skips"
export HS_ATTRITI_SKIPS=$t/skips
mkdir -p "$t/st/handover"; printf "machine\nissue/9\n%s\n" "$(date -d 2026-10-30 +%s)" > "$t/st/handover/sumisura-9"; printf "other\nissue/8\n%s\n" "$(date -d 2026-11-08 +%s)" > "$t/st/handover/studio-8"
HOME=$t HS_REPO=$t/repo HS_SIGNALS_USAGE=$t/usage HS_AUTO_STATE=$t/st HS_SIGNALS_NOW=2026-11-09 HS_ATTRITI_SESSIONS=$t/sess node "$R/device/edge/debian/attriti-signals" > "$t/s.json"
s() { jq -r "$1" "$t/s.json"; }
check "hitl steps: last 30 days only, longest wait first" "$(s '.hitl | map("\(.issue)=\(.answered)=\(.waitedDays)") | join(",")')" "010=false=8,010=true=2,010=true=2,011=true=null"
check "blocked on user" "$(s '.blockedUser | map("\(.issue)=\(.days)") | join(",")')" "010=20"
check "monitor fingerprint repeated (kind), old one ignored" "$(s '.monitorRepeats | map("\(.kind)=\(.count)") | join(",")')" "job-x=2"
check "failed runs" "$(s '.failedRuns | map("\(.issue)=\(.outcome)") | join(",")')" "10=consegnata,12=errore"
check "complaints: owner comment and session text, no tool results" "$(s '.complaints | map(.where) | join(",")')" "ops session,issue 010"
check "counts" "$(s '"\(.counts.hitlAsked) \(.counts.hitlUnanswered)"')" "4 1"
check "credentials: days left" "$(s '.credentials | map("\(.name)=\(.daysLeft)") | join(",")')" "GitHub token=11"
check "skips: told or not" "$(s '.skips | map("\(.job)=\(.told)") | join(",")')" "mail=notifica,x=false"
check "owner chores: login kind" "$(s '.ownerChores | map("\(.kind)=\(.count)") | join(",")')" "login=2"
check "536: unpublished work older than 7 days" "$(s '.unpublishedWork | map("\(.id)=\(.kind)=\(.days)") | join(",")')" "sumisura-9=machine=10"
[ "$fail" = 0 ]
