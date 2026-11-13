#!/bin/sh
# Test of ops-suggest for a Project whose issues live on its host (issue 161, column 5 `github`), with
# HS_SUGGEST_REPLAY (no Claude) and a throwaway HOME: its feedback index only has the proposals tagged
# `Project: NAME`, a title equal to one of its GitHub issues (mirror) is dropped as duplicate, and
# the cap on pending proposals counts per Project (issue 270).
# From the repo root, on the Edge (needs /etc/home-server.env and /opt/hs-tracker/issues.js):
# device/edge/tests/ops-suggest-project.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
mkdir -p "$t/.local/bin" "$t/bin" "$t/projects/sp" "$t/home-server/issues/open" "$t/home-server/issues/done" "$t/home-server/issues/proposed"
ln -s "$R/device/edge/debian/ops-suggest-index" "$t/bin/"
cat > "$t/.local/bin/hs-setting" <<'EOF2'
#!/bin/sh
case $1 in HS_SUGGEST_ENABLED) echo 1 ;; HS_SUGGEST_HOUR) echo 0 ;; HS_SUGGEST_QUOTA_MAX) echo 100 ;;
HS_SUGGEST_PENDING_MAX) echo 10 ;; HS_SUGGEST_MAX) echo 3 ;;
HS_SUGGEST_PAUSE_PZ) [ -f "$HS_T_PAUSE" ] && echo 1 || echo 0 ;; *) exit 1 ;; esac
EOF2
printf '#!/bin/sh\necho "sp - - active github -"\n' > "$t/projects.sh"
chmod +x "$t/.local/bin/hs-setting" "$t/projects.sh"
printf '# Regole di sp\n' > "$t/projects/sp/CLAUDE.md"
git -C "$t/projects/sp" init -q
git -C "$t/projects/sp" -c user.email=t@t -c user.name=t add -A
git -C "$t/projects/sp" -c user.email=t@t -c user.name=t commit -qm init
# One tagged system proposal (sp), one untagged (home-server's own), both pending.
prop() { printf '# %s\n\nOpened: 2026-10-01\nBlocked on: -\nStatus: backlog\nLabels: proposed, feature, afk\nSource: system\n%s\n\nx\n' "$2" "$3" > "$t/home-server/issues/proposed/$1.md"; }
prop 001-tagged "Gia proposta per sp" "Project: sp"
prop 002-local "Proposta di home-server" ""
echo '{"updated":"x","projects":{"sp":{"issues":[{"number":1,"title":"Titolo su GitHub","state":"open","trust":"author"},{"number":2,"title":"Titolo non fidato","state":"open","trust":"other"}]}}}' > "$t/pi.json"
body='## Problema\nx\n## Proposta\nx\n## Criteri di accettazione\nx\n## Piano\nx\n## Esecuzione\n- [ ] x'
mk() { printf '{"title":"%s","kind":"feature","mode":"afk","body":"%s"}' "$1" "$body"; }
ans="{\"proposals\":[$(mk 'Titolo su GitHub'),$(mk 'Gia proposta per sp'),$(mk 'Proposta nuova per sp')],\"preferences\":\"p\"}"
{ echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"README.md"}}]}}'; jq -cn --arg r "$ans" '{type:"result",subtype:"success",is_error:false,result:$r}' ; } > "$t/replay.jsonl"

idx=$(HOME=$t "$R/device/edge/debian/ops-suggest-index" "$t/home-server/issues" sp)
[ "$(echo "$idx" | jq .pending)" = 1 ] || { echo "FAIL: pending is not per Project: $idx"; exit 1; }
[ "$(echo "$idx" | jq '.index | length')" = 1 ] || { echo "FAIL: index not filtered: $idx"; exit 1; }
idx=$(HOME=$t "$R/device/edge/debian/ops-suggest-index" "$t/home-server/issues")
[ "$(echo "$idx" | jq -r '.index[0].title')" = "Proposta di home-server" ] || { echo "FAIL: home-server sees tagged: $idx"; exit 1; }

out=$(HOME=$t HS_SUGGEST_REPLAY=$t/replay.jsonl HS_SUGGEST_PROJECTS=$t/projects.sh HS_PROJECTS_ISSUES=$t/pi.json \
	HS_SUGGEST_STATUS=$t/suggest.json HS_SUGGEST_AUTO_LOCK=$t/auto.lock "$R/device/edge/debian/ops-suggest" --dry-run)
echo "$out" | grep -q '^=== Proposta nuova per sp ' || { echo "FAIL: valid proposal missing"; echo "$out"; exit 1; }
echo "$out" | grep -q '^=== Titolo su GitHub' && { echo "FAIL: GitHub duplicate kept"; echo "$out"; exit 1; }
echo "$out" | grep -q '^=== Gia proposta per sp' && { echo "FAIL: pending duplicate kept"; echo "$out"; exit 1; }
# A paused Project (issue 271): no Claude, listed in the status, not counted as a run.
printf '#!/bin/sh\necho "pz - - active github -"\n' > "$t/pz.sh"; chmod +x "$t/pz.sh"; touch "$t/pause"
out=$(HOME=$t HS_T_PAUSE=$t/pause HS_SUGGEST_REPLAY=$t/replay.jsonl HS_SUGGEST_PROJECTS=$t/pz.sh HS_PROJECTS_ISSUES=$t/pi.json \
	HS_SUGGEST_STATUS=$t/suggest.json HS_SUGGEST_AUTO_LOCK=$t/auto.lock "$R/device/edge/debian/ops-suggest" --now)
[ ! -e "$t/.local/state/ops-suggest/last-day" ] || { echo "FAIL: paused Project counted as a run"; exit 1; }
[ "$(jq -c .paused "$t/suggest.json")" = '["pz"]' ] || { echo "FAIL: paused not in status"; cat "$t/suggest.json"; exit 1; }
grep -q 'pz: proposte in pausa' "$t/.local/state/ops-suggest/ops-suggest.log" || { echo "FAIL: pause not logged"; exit 1; }
# ideas.md of the Project joins the rules (issue 306).
printf "Voglio X\n" > "$t/projects/sp/ideas.md"
HOME=$t HS_SUGGEST_REPLAY=$t/replay.jsonl HS_SUGGEST_PROJECTS=$t/projects.sh HS_PROJECTS_ISSUES=$t/pi.json \
	HS_SUGGEST_STATUS=$t/suggest.json HS_SUGGEST_AUTO_LOCK=$t/auto.lock "$R/device/edge/debian/ops-suggest" --dry-run >/dev/null
grep -q 'sp: ideas.md letto' "$t/.local/state/ops-suggest/ops-suggest.log" || { echo "FAIL: ideas.md not read"; exit 1; }
echo "ok: ops-suggest project"
