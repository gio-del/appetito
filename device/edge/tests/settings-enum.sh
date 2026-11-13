#!/bin/sh
# Test of the settings `enum` type (issue 085: Claude model of the headless jobs): the tracker
# accepts listed values and refuses others with 400; hs-setting prints the value or the default.
# Runs a throwaway tracker on a temp repo/state. From the repo root: device/edge/tests/settings-enum.sh
set -eu
R=$(pwd)
t=$(mktemp -d); pid=
trap '[ -z "$pid" ] || kill $pid 2>/dev/null; rm -rf "$t"' EXIT
mkdir -p "$t/repo/issues/open" "$t/repo/issues/done" "$t/state"
PORT=${PORT:-3914} O="https://test.example:8444"
node -e '
const c = require("node:crypto"), s = c.randomBytes(16), N = 16384, r = 8, p = 1;
const k = c.scryptSync("test-password-123", s, 32, { N, r, p, maxmem: 256 * N * r + (1 << 20) });
process.stdout.write(["scrypt", N, r, p, s.toString("base64"), k.toString("base64")].join("$") + "\n");' > "$t/state/password"
TRACKER_REPO=$t/repo TRACKER_STATE=$t/state TRACKER_PORT=$PORT TRACKER_ORIGINS=$O \
	TRACKER_SETTINGS=$t/settings.env node "$R/device/edge/tracker/server.js" > "$t/log" 2>&1 &
pid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null && break; sleep 0.3; done
H="-H Host:test.example:8444 -H Origin:$O -H Content-Type:application/json"
ck=$(curl -s -D - -o /dev/null $H -d '{"password":"test-password-123"}' "http://127.0.0.1:$PORT/api/login" \
	| sed -n 's/^[Ss]et-[Cc]ookie: \([^;]*\).*/\1/p' | head -1)
[ -n "$ck" ] || { echo "FAIL: login"; cat "$t/log"; exit 1; }
put() { curl -s -o /dev/null -w '%{http_code}' $H -H "Cookie: $ck" -X PUT -d "$1" "http://127.0.0.1:$PORT/api/settings"; }
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
hs() { HS_SETTINGS_SCHEMA=$R/device/edge/tracker/settings.schema.json HS_SETTINGS_FILE=$t/settings.env \
	HS_SETTINGS_ENV=$t/none sh "$R/device/edge/debian/hs-setting" "$1"; }

check "defaults" "$(hs HS_AUTO_MODEL) $(hs HS_SUGGEST_MODEL) $(hs HS_BRAIN_MODEL)" "default default sonnet"
check "PUT listed value" "$(put '{"values":{"HS_AUTO_MODEL":"sonnet","HS_BRAIN_MODEL":"default"}}')" 200
check "hs-setting reads it" "$(hs HS_AUTO_MODEL) $(hs HS_BRAIN_MODEL)" "sonnet default"
check "PUT unlisted value" "$(put '{"values":{"HS_AUTO_MODEL":"claude-opus-5-5"}}')" 400
check "PUT non-string" "$(put '{"values":{"HS_SUGGEST_MODEL":1}}')" 400
check "refused PUT changes nothing" "$(hs HS_AUTO_MODEL)" sonnet
echo 'HS_SUGGEST_MODEL=gpt' >> "$t/settings.env"
check "invalid file value = default" "$(hs HS_SUGGEST_MODEL)" default
check "PUT null = back to default" "$(put '{"values":{"HS_AUTO_MODEL":null}}')" 200
check "default again" "$(hs HS_AUTO_MODEL)" default
exit $fail
