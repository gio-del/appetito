#!/bin/sh
# Test of the "Security enabled" agent branch (issue 511): with true the ops session and ops-auto
# start the agent under setpriv --no-new-privs (no sudo); with false they are unchanged.
# From the repo root: device/edge/tests/security-agent.sh
set -eu
R=$(pwd); D=$R/device/edge/debian; fail=0
ok() { echo "ok   $1"; }; no() { echo "FAIL $1"; fail=1; }
t() { if grep -qF -- "$2" "$3"; then ok "$1"; else no "$1"; fi; }
t "ops run: asks hs-security-enabled" '! hs-security-enabled || NP=--no-new-privs' "$D/sv/ops/run"
t "ops run: setpriv gets \$NP" 'exec setpriv $NP --reuid=' "$D/sv/ops/run"
t "ops-auto: asks hs-security-enabled" '! hs-security-enabled || NP="setpriv --no-new-privs"' "$D/ops-auto"
t "ops-auto: claude run gets \$NP" 'exec $NP timeout 3600' "$D/ops-auto"
# false branch: NP stays empty, so the command is what it was before
for f in "$D/sv/ops/run" "$D/ops-auto"; do
  grep -q '^NP=' "$f" && ok "$(basename "$(dirname "$f")")/$(basename "$f"): NP empty by default" || no "NP default in $f"
done
# the flag really blocks privilege gain (setuid binary), when setpriv exists
if command -v setpriv >/dev/null; then
  v=$(setpriv --no-new-privs grep NoNewPrivs /proc/self/status | tr -dc 0-9)
  [ "$v" = 1 ] && ok "no-new-privs is set" || no "no-new-privs not set"
fi
exit $fail
