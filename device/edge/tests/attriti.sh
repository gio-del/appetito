#!/bin/sh
# Test of attriti (issue 468): replayed AI answer -> validated -> issues with Fingerprint/Origin; an open
# fingerprint is not repeated, a closed one comes back with "Si ripete" + Related; max per round.
# Throwaway HOME, no AI. From the repo root: device/edge/tests/attriti.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
mkdir -p "$t/.local/bin" "$t/repo/issues/open" "$t/repo/issues/done"
cat > "$t/.local/bin/hs-setting" <<'EOF2'
#!/bin/sh
case $1 in HS_ATTRITI_MAX) echo "${T_MAX:-2}" ;; HS_SUGGEST_QUOTA_MAX) echo 100 ;; *) exit 1 ;; esac
EOF2
cat > "$t/.local/bin/issues-new" <<EOF2
#!/bin/sh
exec node $R/device/edge/tracker/issues.js --new "\$@"
EOF2
chmod +x "$t/.local/bin/"*
echo '{"hitl":[]}' > "$t/sigs.json"; printf '#!/bin/sh\ncat %s/sigs.json\n' "$t" > "$t/sigs.sh"; chmod +x "$t/sigs.sh"
ans='{"attriti":[
{"key":"mail-weekend","title":"La mail del weekend salta in silenzio","rule":1,"proof":"vault vince su impostazione","fix":"Dire nella mail quando vince la nota","hitl":null},
{"key":"gia-aperta","title":"Attrito già aperto","rule":2,"proof":"p","fix":"f","hitl":null},
{"key":"si-ripete","title":"Attrito che torna","rule":5,"proof":"p","fix":"f","hitl":"Scegli a o b (raccomando a)"},
{"key":"Bad Key","title":"Chiave non valida","rule":1,"proof":"p","fix":"f","hitl":null},
{"key":"terzo-oltre-max","title":"Oltre il massimo","rule":1,"proof":"p","fix":"f","hitl":null}]}'
jq -nc --arg r "$ans" '{type:"result",result:$r}' > "$t/replay.jsonl"
printf '# Vecchia\n\nOpened: 2026-11-01\nBlocked on: -\nStatus: todo\nLabels: attrito\nFingerprint: attrito-gia-aperta\n\nx\n' > "$t/repo/issues/open/001-vecchia.md"
printf '# Chiusa\n\nOpened: 2026-11-01\nClosed: 2026-11-05\nStatus: done\nFingerprint: attrito-si-ripete\n\nx\n' > "$t/repo/issues/done/002-chiusa.md"
run() { PATH=$t/.local/bin:$PATH HOME=$t HS_ATTRITI_REPO=$t/repo ISSUES_REPO=$t/repo HS_ATTRITI_REPLAY=$t/replay.jsonl HS_ATTRITI_SIGNALS=$t/sigs.sh \
	HS_ATTRITI_AUTO_LOCK=$t/auto.lock HS_AI_RUN=/bin/false "$R/device/edge/debian/attriti" "$@"; }
fail=0
check() { [ "$2" = "$3" ] || { echo "FAIL: $1: got '$2', want '$3'"; fail=1; }; }
run --dry-run > "$t/dry.txt"
check "dry creates nothing" "$(ls "$t/repo/issues/open" | wc -l)" 1
check "dry shows first" "$(grep -c '^=== La mail del weekend' "$t/dry.txt")" 1
run --now > /dev/null
check "max 2: one open skipped, two new" "$(ls "$t/repo/issues/open" | wc -l)" 3
f=$(grep -l 'attrito-mail-weekend' "$t"/repo/issues/open/*.md)
check "origin" "$(grep -c '^Origin: attriti$' "$f")" 1
check "status todo" "$(grep -c '^Status: todo$' "$f")" 1
check "label" "$(grep -c '^Labels: attrito$' "$f")" 1
check "step" "$(grep -c '^- \[ \] Dire nella mail' "$f")" 1
check "no bad key" "$(grep -l 'Chiave non valida' "$t"/repo/issues/open/*.md 2>/dev/null | wc -l)" 0
# second round: max 3 now, the returning one reopens with Related
T_MAX=3 run --now > /dev/null
g=$(grep -l 'attrito-si-ripete' "$t"/repo/issues/open/*.md)
check "si ripete" "$(grep -c 'Si ripete: la #002' "$g")" 1
check "related" "$(grep -c '^Related: 002' "$g")" 1
check "hitl step" "$(grep -c '^- \[ \] (HITL) Scegli a o b' "$g")" 1
check "no duplicate of open" "$(grep -l 'attrito-mail-weekend' "$t"/repo/issues/open/*.md | wc -l)" 1
# cron mode: once a week
echo "$(date +%F)" > "$t/.local/state/attriti/last-day"
before=$(ls "$t/repo/issues/open" | wc -l); run >/dev/null; check "cron waits 7 days" "$(ls "$t/repo/issues/open" | wc -l)" "$before"
[ "$fail" = 0 ] && echo "attriti: ok"
exit "$fail"
