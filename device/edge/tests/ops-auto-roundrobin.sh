#!/bin/sh
# Test of the round robin of the ops-auto queue (issue 216): home-server and each Project take turns
# starting after the source in $ST/rr; monitor issues and red-CI Project entries stay in front; an empty
# source is skipped; no $ST/rr starts from home-server. Temp HOME only. From the repo root: device/edge/tests/ops-auto-roundrobin.sh
set -eu
R=$(pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
H=$t/home; ST=$H/.local/state/ops-auto
mkdir -p "$H/bin" "$H/.local/bin" "$H/home-server/issues/open" "$ST/ci"
cp "$R/device/edge/debian/ai-run" "$R/device/edge/debian/ops-auto" "$H/bin/"
printf '#!/bin/sh\necho 50\n' > "$H/.local/bin/hs-setting"; chmod +x "$H/.local/bin/hs-setting"
O=$H/home-server/issues/open
mk() { printf '# Issue %s\n\nOpened: 2026-10-15\nBlocked on: -\nStatus: todo\nPriority: %s\nLabels: %s\n\nbody\n' "$1" "$2" "$3" > "$O/$1.md"; }
fail() { echo "FAIL: $*"; exit 1; }
cat > "$t/projects" <<'EOP'
home-server | - | - | active | issues | -
beta | https://x/b.git | - | active | github | -
sumisura | https://x/s.git | s | active | github | -
EOP
iss() { printf '{"number":%s,"state":"open","trust":"author","labels":[]}' "$1"; }
echo "{\"projects\":{\"beta\":{\"stale\":false,\"issues\":[$(iss 1),$(iss 2),$(iss 3)]},\"sumisura\":{\"stale\":false,\"issues\":[$(iss 10),$(iss 11)]}}}" > "$t/mirror.json"
q() { HOME=$H HS_ISSUES_JS=$R/device/edge/tracker/issues.js HS_QUEUE_CONFIG=${QC:-$t/none.json} HS_QUEUE_PROJECTS_JSON=$t/mirror.json HS_PROJECTS_FILE=$t/projects "$H/bin/ops-auto" --queue | sed 's/\.md$//' | tr '\n' ' '; }
mk 010-a urgent ""; mk 011-b low ""
[ "$(q)" = "010-a beta-1 sumisura-10 011-b beta-2 sumisura-11 beta-3 " ] || fail "alternation: $(q)"
echo sumisura > "$ST/rr"
[ "$(q)" = "010-a beta-1 sumisura-10 011-b beta-2 sumisura-11 beta-3 " ] || fail "after sumisura: $(q)"
echo home-server > "$ST/rr"
[ "$(q)" = "beta-1 sumisura-10 010-a beta-2 sumisura-11 011-b beta-3 " ] || fail "after home-server: $(q)"
echo beta > "$ST/rr"
[ "$(q)" = "sumisura-10 010-a beta-1 sumisura-11 011-b beta-2 beta-3 " ] || fail "after beta: $(q)"
# monitor and red CI stay in front
mk 012-mon "" monitor; echo "ci rosso" > "$ST/ci/sumisura-11"
[ "$(q)" = "sumisura-11 012-mon sumisura-10 010-a beta-1 011-b beta-2 beta-3 " ] || fail "front: $(q)"
# an empty source is skipped
rm -f "$O"/*.md "$ST/ci/sumisura-11"; echo home-server > "$ST/rr"
[ "$(q)" = "beta-1 sumisura-10 beta-2 sumisura-11 beta-3 " ] || fail "empty source: $(q)"
# --- strategies (issue 225): 3 sources, config in a JSON file
rm -f "$O"/*.md "$ST/ci"/*; mk 010-a urgent ""; mk 011-b low ""; mk 012-c "" ""
echo "{\"projects\":{\"beta\":{\"stale\":false,\"issues\":[$(iss 1),{\"number\":2,\"state\":\"open\",\"trust\":\"author\",\"labels\":[\"priority:urgent\"]},$(iss 3),$(iss 4)]},\"sumisura\":{\"stale\":false,\"issues\":[$(iss 10),{\"number\":11,\"state\":\"open\",\"trust\":\"author\",\"labels\":[\"priority:high\"]}]}}}" > "$t/mirror.json"
cfg() { printf '%s' "$1" > "$t/cfg.json"; QC=$t/cfg.json q; }
rm -f "$ST/rr"
[ "$(cfg '{"strategy":"rotation","urgent_first":false,"focus":"","sources":{}}')" = "010-a beta-1 sumisura-10 012-c beta-2 sumisura-11 011-b beta-3 beta-4 " ] || fail "rotation cfg: $(q)"
W='{"strategy":"weighted","urgent_first":false,"focus":"","sources":{"home-server":{"weight":3,"paused":false},"beta":{"weight":2,"paused":false},"sumisura":{"weight":1,"paused":false}}}'
[ "$(cfg "$W")" = "010-a 012-c 011-b beta-1 beta-2 sumisura-10 beta-3 beta-4 sumisura-11 " ] || fail "weighted 3/2/1: $(cfg "$W")"
echo "beta 1" > "$ST/rr"
[ "$(cfg "$W")" = "beta-1 sumisura-10 010-a 012-c 011-b beta-2 beta-3 sumisura-11 beta-4 " ] || fail "weighted continues the turn: $(cfg "$W")"
echo "beta 2" > "$ST/rr"
[ "$(cfg "$W")" = "sumisura-10 010-a 012-c 011-b beta-1 beta-2 sumisura-11 beta-3 beta-4 " ] || fail "weighted after full turn: $(cfg "$W")"
rm -f "$ST/rr"
P='{"strategy":"priority","urgent_first":false,"focus":"","sources":{}}'
[ "$(cfg "$P")" = "010-a beta-2 sumisura-11 beta-1 sumisura-10 012-c beta-3 beta-4 011-b " ] || fail "priority (labels): $(cfg "$P")"
F='{"strategy":"focus","urgent_first":false,"focus":"sumisura","sources":{}}'
[ "$(cfg "$F")" = "sumisura-10 sumisura-11 010-a beta-1 012-c beta-2 011-b beta-3 beta-4 " ] || fail "focus: $(cfg "$F")"
U='{"strategy":"rotation","urgent_first":true,"focus":"","sources":{}}'
[ "$(cfg "$U")" = "010-a beta-2 beta-1 sumisura-10 012-c sumisura-11 011-b beta-3 beta-4 " ] || fail "urgent_first: $(cfg "$U")"
PA='{"strategy":"rotation","urgent_first":false,"focus":"","sources":{"beta":{"weight":1,"paused":true}}}'
[ "$(cfg "$PA")" = "010-a sumisura-10 012-c sumisura-11 011-b " ] || fail "paused: $(cfg "$PA")"
# exceptions in front stay, even for a paused source and under focus
mk 013-mon "" monitor; echo "ci rosso" > "$ST/ci/beta-3"
[ "$(cfg "$F")" = "beta-3 013-mon sumisura-10 sumisura-11 010-a beta-1 012-c beta-2 011-b beta-4 " ] || fail "front: $(cfg "$F")"
[ "$(cfg "$PA")" = "beta-3 013-mon 010-a sumisura-10 012-c sumisura-11 011-b " ] || fail "front paused: $(cfg "$PA")"
# an invalid config is today's rotation
rm -f "$ST/ci"/*
[ "$(cfg '{"strategy":"nonsense"}')" = "$(cfg "$U" >/dev/null; rm -f "$t/cfg.json"; q)" ] || fail "invalid config"
echo "ok"
