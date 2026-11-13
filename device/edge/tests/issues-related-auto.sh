#!/bin/sh
# Test of the two-tier duplicate check (issue 262): similar but different work gets `Related` from housekeep
# (with a "(sistema)" comment, once) and no lint issue; near-identical text stays a manual possible-duplicate.
# Temp repo only. From the repo root: device/edge/tests/issues-related-auto.sh
set -eu
J=$(pwd)/device/edge/tracker/issues.js
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/issues/open" "$t/issues/done" "$t/issues/proposed"
fail() { echo "FAIL: $*"; exit 1; }
w() { printf '# %s\n\nOpened: 2026-10-28\nBlocked on: -\nStatus: todo\n\n%s\n' "$2" "$3" > "$t/issues/open/$1.md"; }
w 001-a 'Backend AI: verifica finale' 'Verificare che il consumo per backend sia registrato e mostrato nella pagina auto, con test.'
w 002-b 'Backend AI: metriche di consumo per backend' 'Registrare il consumo per backend AI di ops-auto e mostrarlo nella pagina auto.'
w 003-c 'Cache dei certificati Caddy' 'Spostare la cache dei certificati di Caddy fuori dal chroot e verificare il rinnovo.'
w 004-d 'Cache dei certificati Caddy' 'Spostare la cache dei certificati di Caddy fuori dal chroot e verificare il rinnovo.'
w 005-e 'Rotazione dei log del tracker' 'I log del tracker crescono senza limite: ruotarli ogni notte.'
w 006-f "Sicurezza: audit delle porte" "Controllare le porte aperte del server e documentare ogni risultato nel file."
w 007-g "Sicurezza: audit delle porte" "Controllare le porte aperte del server e documentare ogni risultato nel file."
sed -i "s/^Status: todo/Status: todo\nParent: 008/" "$t/issues/open/006-f.md" "$t/issues/open/007-g.md"
w 008-h "Epic sicurezza" "Contenitore."
sed -i "s/^Status: todo/Status: todo\nLabels: epic/" "$t/issues/open/008-h.md"
dup() { node "$J" --lint "$t" | jq -r '[.[] | select(.rule == "possible-duplicate") | .fp] | sort | join(" ")'; }
[ "$(dup)" = "lint-possible-duplicate-003-004" ] || fail "manual duplicates: $(dup)"
node "$J" "$t" >/dev/null
[ "$(dup)" = "lint-possible-duplicate-003-004" ] || fail "manual duplicates after housekeep: $(dup)"
[ -z "$(node "$J" --lint "$t" | jq -r '.[] | select(.rule == "related-auto")')" ] || fail "related-auto findings left"
grep -q "^Related: 002" "$t/issues/open/001-a.md" || fail "001 not linked to 002"
grep -c "(sistema)" "$t/issues/open/001-a.md" | grep -qx 1 || fail "no single (sistema) comment"
n=$(grep -c '^Related:' "$t/issues/open/003-c.md" "$t/issues/open/004-d.md" | awk -F: '{s+=$2} END{print s}')
[ "$n" = 0 ] || fail "true duplicate got Related"
[ -z "$(node "$J" "$t")" ] || fail "housekeep not idempotent"
echo "ok: issues-related-auto"
