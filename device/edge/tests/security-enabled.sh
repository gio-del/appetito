#!/bin/sh
# Test of hs-security-enabled (issue 488): true by default and for anything but "false".
# From the repo root: device/edge/tests/security-enabled.sh
set -eu
R=$(pwd); t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
S=$R/device/edge/debian/hs-security-enabled; fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
p() { printf '%s' "$1" > "$t/env"; HS_SETTINGS_ENV=$t/env sh "$S" --print; }
check "missing file" "$(HS_SETTINGS_ENV=$t/none sh "$S" --print)" true
check "unset" "$(p 'HS_USER=x
')" true
check "true" "$(p 'HS_SECURITY_ENABLED=true
')" true
check "false" "$(p 'HS_SECURITY_ENABLED=false
')" false
check "quoted false" "$(p 'HS_SECURITY_ENABLED="false"
')" false
check "garbage = true" "$(p 'HS_SECURITY_ENABLED=0
')" true
check "empty = true" "$(p 'HS_SECURITY_ENABLED=
')" true
check "last wins" "$(p 'HS_SECURITY_ENABLED=false
HS_SECURITY_ENABLED=true
')" true
printf 'HS_SECURITY_ENABLED=false\n' > "$t/env"
if HS_SETTINGS_ENV=$t/env sh "$S"; then check "exit code false" 0 1; else check "exit code false" 1 1; fi
printf 'HS_SECURITY_ENABLED=true\n' > "$t/env"
if HS_SETTINGS_ENV=$t/env sh "$S"; then check "exit code true" 0 0; else check "exit code true" 1 0; fi
# the template for installers defaults to true
check "example is true" "$(HS_SETTINGS_ENV=$R/device/edge/home-server.env.example sh "$S" --print)" true
grep -q '^HS_SECURITY_ENABLED=true' "$R/device/edge/home-server.env.example" && echo "ok   example sets it" || { echo "FAIL example lacks HS_SECURITY_ENABLED=true"; fail=1; }
exit $fail
