#!/bin/sh
# Test of hs-monitor's known remedies (issue 116) with the repo runbook and a fake command runner.
# Run from the repo root: device/edge/tests/hs-monitor-runbook.sh
set -eu
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
H=3600000 NOW=2000000000000
rb=$(node -e 'console.log(JSON.stringify(require("fs").readFileSync("device/edge/debian/hs-runbook","utf8")))')
SVC='{ "fp": "svc-radicale", "svc": "radicale" }'
# Run 1: radicale down (restart, no issue), Homepage config error (issue, no restart), tailscaled
# down (never restarted: issue), a job failure (no rule: issue), disk full (cleaning fails: issue
# with the attempt), caddy not answering but its issue is already open (no remedy).
# Run 2, 1 h later: radicale still down (attempt used up: issue with the attempt), backup not
# reaching the PC (rescan). Run 3, 7 h later: radicale down again (window over: a new restart).
cat > "$t/fake.json" <<J
{ "runbook": $rb, "runs": [
  { "now": $NOW, "fail": ["apt-get"], "open": ["url-caddy"], "found": [ $SVC,
    { "fp": "url-homepage", "svc": "homepage", "config": true },
    { "fp": "svc-tailscaled", "svc": "tailscaled" },
    { "fp": "job-selftest" }, { "fp": "disk-root" },
    { "fp": "url-caddy", "svc": "caddy" } ] },
  { "now": $((NOW + H)), "found": [ $SVC, { "fp": "backup-offsite" } ] },
  { "now": $((NOW + 8*H)), "found": [ $SVC ] } ] }
J
TZ=UTC device/edge/debian/hs-monitor --runbook-test "$t/fake.json" > "$t/out"
cat > "$t/want" <<'W'
{"tried":[{"fp":"svc-radicale","action":"sv-restart","ok":true},{"fp":"disk-root","action":"disk-clean","ok":false}],"open":["url-homepage","svc-tailscaled","job-selftest","disk-root\nRimedi già tentati da `hs-monitor` senza risolvere (runbook `device/edge/debian/hs-runbook`, issue 116):\n- 2033-05-18 03:33: pulizia delle cache rigenerabili (`apt-get clean`, `~/.cache/go-build`, cartelle di build in `/var/tmp` più vecchie di un giorno): il comando è fallito\n","url-caddy"]}
{"tried":[{"fp":"backup-offsite","action":"syncthing-rescan","ok":true}],"open":["svc-radicale\nRimedi già tentati da `hs-monitor` senza risolvere (runbook `device/edge/debian/hs-runbook`, issue 116):\n- 2033-05-18 03:33: riavvio del servizio `radicale` (`sv restart`): eseguito, il problema è rimasto\n"]}
{"tried":[{"fp":"svc-radicale","action":"sv-restart","ok":true}],"open":[]}
W
if diff -u "$t/want" "$t/out"; then echo "ok: hs-monitor runbook"; else echo "FAIL: hs-monitor runbook"; exit 1; fi
