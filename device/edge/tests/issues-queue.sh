#!/bin/sh
# Test of the shared ops-auto queue (issue 099): `issues.js --queue` (used by `ops-auto --queue` and,
# as queueOf, by the tracker's /api/auto) picks open, unblocked, non-epic monitor or todo/in-progress
# issues, monitor first, then by Priority, then file name, skipping a future Not before: (issue 145); ops-auto-request rewrites the card only
# when an issue changed since its last write. Temp dirs only. From the repo root: device/edge/tests/issues-queue.sh
set -eu
R=$(pwd); J=$R/device/edge/tracker/issues.js
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
O=$t/home-server/issues/open; mkdir -p "$O" "$t/home-server/issues/done" "$t/bin" "$t/.local/state/ops-auto"
mk() { printf '# Issue %s\n\nOpened: 2026-10-15\nBlocked on: %s\nStatus: %s\nPriority: %s\nLabels: %s\n\nbody\n' "$1" "$2" "$3" "$4" "$5" > "$O/$1.md"; }
fail() { echo "FAIL: $*"; exit 1; }
mk 010-low - todo low ""
mk 011-none - in-progress "" ""
mk 012-urgent - todo urgent ""
mk 013-monitor - backlog "" "monitor"
mk 014-blocked "user (x)" todo urgent ""
mk 015-epic - todo high "epic"
mk 016-backlog - backlog high ""
mk 017-mon-high - todo high "monitor, lint"
got=$(HS_QUEUE_PROJECTS_JSON=$t/none.json node "$J" --queue "$t/home-server" | tr '\n' ' ')
[ "$got" = "017-mon-high.md 013-monitor.md 012-urgent.md 011-none.md 010-low.md " ] || fail "order: $got"

# Not before: (issue 145): skipped while the local date is earlier, picked from that day; an invalid date
# holds nothing back and is reported by the lint.
nb() { mk "$1" - todo "" ""; sed -i "s/^Status: todo$/Status: todo\nNot before: $2/" "$O/$1.md"; }
nb 020-wait 2026-10-28; nb 021-bad 2026-02-30
[ "$(HS_QUEUE_NOW=2026-10-27 node "$J" --queue "$t/home-server" | grep '^02' | tr '\n' ' ')" = "021-bad.md " ] || fail "not before: picked early"
[ "$(HS_QUEUE_NOW=2026-10-28 node "$J" --queue "$t/home-server" | grep '^02' | tr '\n' ' ')" = "020-wait.md 021-bad.md " ] || fail "not before: not picked on the day"
lint=$(node "$J" --lint "$t/home-server" | grep -o 'lint-not-before-bad-[0-9]*' | tr '\n' ' ')
[ "$lint" = "lint-not-before-bad-021 " ] || fail "not before lint: $lint"
node -e 'const i=require(process.argv[1]);const p=i.parse("# x\n\nNot before: 2026-10-28\n");if(i.waitingUntil(p,new Date(2026,9,27,23,59).getTime())!=="2026-10-28"||i.waitingUntil(p,new Date(2026,9,28,0,1).getTime())!=="")process.exit(1)' "$J" || fail "waitingUntil"
rm "$O"/020-wait.md "$O"/021-bad.md

# Trusted issues of the other Projects (issue 186): after home-server's queue, Projects in the order of
# the projects list, ascending number; untrusted, closed, blocked/epic and stale ones left out.
cat > "$t/projects" <<'EOP'
# comment
home-server | - | - | active | issues | -
beta | https://x/b.git | - | active | github | -
sumisura | https://x/s.git | s | active | github | -
EOP
iss() { printf '{"number":%s,"state":"%s","trust":"%s","labels":[%s]}' "$1" "$2" "$3" "$4"; }
cat > "$t/mirror.json" <<EOJ
{"projects":{"sumisura":{"stale":false,"issues":[$(iss 230 open author ""),$(iss 221 open self-assigned ""),$(iss 222 open untrusted ""),$(iss 223 closed author ""),$(iss 224 open author '"blocked"'),$(iss 225 open author '"epic"')]},"beta":{"stale":false,"issues":[$(iss 3 open author '"bug"')]},"gone":{"stale":true,"issues":[$(iss 1 open author "")]}}}
EOJ
got=$(HS_QUEUE_PROJECTS_JSON=$t/mirror.json HS_PROJECTS_FILE=$t/projects node "$J" --queue "$t/home-server" | tail -4 | tr '\n' ' ')
[ "$got" = "beta-3 sumisura-221 sumisura-230 " ] || [ "$got" = "010-low.md beta-3 sumisura-221 sumisura-230 " ] || fail "project queue: $got"
[ "$(node "$J" --queue "$t/home-server" | grep -c -- '-221')" = 0 ] || fail "project queue without opt-in"
[ "$(HS_QUEUE_PROJECTS_JSON=$t/none.json node "$J" --queue "$t/home-server" | grep -c sumisura)" = 0 ] || fail "missing mirror"


# Entries that wait (issue 259): an open PR of ours (young state file), a hold, a Project without CI; one rule, `--waiting`.
mkdir -p "$t/st/pr" "$t/st/hold" "$t/st/noci"
echo https://github.com/x/s/pull/42 > "$t/st/pr/sumisura-221"; touch "$t/st/hold/sumisura-230"
echo https://github.com/x/b/pull/9 > "$t/st/pr/beta-3"; touch -d '8 days ago' "$t/st/pr/beta-3"
w=$(HS_QUEUE_PROJECTS_JSON=$t/mirror.json HS_PROJECTS_FILE=$t/projects node "$J" --waiting "$t/st")
[ "$(echo "$w" | jq -r '."sumisura-221".why + ":" + ."sumisura-221".pr')" = "pr:https://github.com/x/s/pull/42" ] || fail "waiting pr: $w"
[ "$(echo "$w" | jq -r '."sumisura-230".why')" = hold ] || fail "waiting hold: $w"
[ "$(echo "$w" | jq 'has("beta-3")')" = false ] || fail "old PR state still waits: $w"
touch "$t/st/noci/beta"; w=$(HS_QUEUE_PROJECTS_JSON=$t/mirror.json HS_PROJECTS_FILE=$t/projects node "$J" --waiting "$t/st")
[ "$(echo "$w" | jq -r '."beta-3".why')" = ci ] || fail "waiting ci: $w"
# ops-auto-request: card rewritten when an issue is newer than its status file, not otherwise.
cp "$R/device/edge/debian/ops-auto-request" "$t/bin/"
printf '#!/bin/sh\necho x >> "%s/card-runs"; touch "%s/detail.json"\n' "$t" "$t" > "$t/bin/ops-auto-card"; chmod +x "$t/bin/ops-auto-card"
req() { HOME=$t HS_AUTO_REQUEST=$t/none.json HS_AUTO_DETAIL=$t/detail.json "$t/bin/ops-auto-request"; }
runs() { cat "$t/card-runs" 2>/dev/null | wc -l; }
req; [ "$(runs)" = 1 ] || fail "no status file: card not run"
touch -d '1 minute ago' "$O"/* "$O" "$t/home-server/issues/done"
req; [ "$(runs)" = 1 ] || fail "no change: card run again"
mk 018-new - todo "" ""
req; [ "$(runs)" = 2 ] || fail "new issue: card not run"
req; [ "$(runs)" = 2 ] || fail "after refresh: card run again"
# the settings file (issue 176): a change after the status rewrites the card
export HS_SETTINGS_FILE=$t/settings.env
req; [ "$(runs)" = 2 ] || fail "no settings file: card run"
touch -d '1 minute ago' "$t/detail.json"; touch "$t/settings.env"
req; [ "$(runs)" = 3 ] || fail "settings changed: card not run"
req; [ "$(runs)" = 3 ] || fail "settings, after refresh: card run again"
echo "ok: issues-queue"
