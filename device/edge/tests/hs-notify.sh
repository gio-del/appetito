#!/bin/sh
# Test of debian/hs-notify and the no-op of debian/ntfy-setup (issue 230) with a fake ntfy server (node):
# off (no service link or no token) = exit 0 and nothing sent; on = one JSON message with the token as
# Bearer; at most 3 actions, only `view`; bad arguments exit 2; a failing server exits 1.
# Run from the repo root: device/edge/tests/hs-notify.sh
set -eu
N=$PWD/device/edge/debian/hs-notify
SETUP=$PWD/device/edge/debian/ntfy-setup
t=$(mktemp -d); trap 'kill $pid 2>/dev/null || true; rm -rf "$t"' EXIT
fail() { echo "FAIL: hs-notify: $*"; cat "$t/err" 2>/dev/null; exit 1; }
cat > "$t/srv.js" <<'JS'
const http = require('http'), fs = require('fs');
http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
  fs.appendFileSync(process.argv[2], JSON.stringify({ auth: q.headers.authorization, body: b }) + '\n');
  r.statusCode = process.env.FAIL ? 500 : 200; r.end('{}'); }); })
  .listen(0, '127.0.0.1', function () { fs.writeFileSync(process.argv[3], String(this.address().port)); });
JS
node "$t/srv.js" "$t/got" "$t/port" & pid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$t/port" ] && break; sleep 0.3; done
mkdir -p "$t/sv"; : > "$t/got"
echo "tk_secret123" > "$t/token"
run() { env HS_SERVICE_DIR=$t/sv HS_NTFY_TOKEN_FILE=$t/token HS_NTFY_URL=http://127.0.0.1:$(cat "$t/port") sh "$N" "$@" 2> "$t/err"; }
# 1. service not enabled: no-op.
run T M || fail "off run"; [ ! -s "$t/got" ] || fail "sent while disabled"
# 2. enabled but no token: no-op.
ln -s /etc/hs-sv/ntfy "$t/sv/ntfy"; mv "$t/token" "$t/token.x"
run T M || fail "no token run"; [ ! -s "$t/got" ] || fail "sent without token"; mv "$t/token.x" "$t/token"
# 3. on: priority, tags, click, actions, token not on the command line.
run --urgent --tag battery --click https://h.example/x --action "Apri=https://h.example/a?b=1" --action "Altro=https://h.example/c" "Titolo àè" "Testo \"quotato\"" || fail "on run"
[ "$(wc -l < "$t/got")" = 1 ] || fail "one message expected"
l=$(cat "$t/got")
[ "$(printf "%s\n" "$l" | jq -r .auth)" = "Bearer tk_secret123" ] || fail "bearer"
b=$(printf "%s\n" "$l" | jq -c '.body | fromjson')
[ "$(printf "%s\n" "$b" | jq -r '[.topic, .title, .message, .priority, .click, .tags[0]] | join("|")')" = 'hs-edge|Titolo àè|Testo "quotato"|5|https://h.example/x|battery' ] || fail "fields: $b"
[ "$(printf "%s\n" "$b" | jq -r '[.actions[] | .action + "=" + .label + "=" + .url] | join(" ")')" = 'view=Apri=https://h.example/a?b=1 view=Altro=https://h.example/c' ] || fail "actions: $b"
# 4. defaults: normal priority, no extra fields.
: > "$t/got"; run T M || fail "plain run"
[ "$(jq -c '.body | fromjson | keys' "$t/got")" = '["message","priority","title","topic"]' ] || fail "plain keys"
# 5. 4 actions, a non-URL, an unknown option, wrong argument count: exit 2, nothing sent.
: > "$t/got"
a=--action; u=https://h.example
rc=0; run $a A=$u $a B=$u $a C=$u $a D=$u T M || rc=$?; [ "$rc" = 2 ] || fail "4 actions accepted"
rc=0; run $a "A=javascript:x" T M || rc=$?; [ "$rc" = 2 ] || fail "non-http action accepted"
rc=0; run --click ftp://x T M || rc=$?; [ "$rc" = 2 ] || fail "non-http click accepted"
rc=0; run --http T M || rc=$?; [ "$rc" = 2 ] || fail "unknown option accepted"
rc=0; run T || rc=$?; [ "$rc" = 2 ] || fail "missing text accepted"
[ ! -s "$t/got" ] || fail "sent after bad arguments"
# 6. a failing server: exit 1.
kill $pid; FAIL=1 node "$t/srv.js" "$t/got" "$t/port2" & pid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$t/port2" ] && break; sleep 0.3; done
rc=0; env HS_SERVICE_DIR=$t/sv HS_NTFY_TOKEN_FILE=$t/token HS_NTFY_URL=http://127.0.0.1:$(cat "$t/port2") sh "$N" T M 2> "$t/err" || rc=$?
[ "$rc" = 1 ] || fail "failing server gave $rc"
# 7. ntfy-setup without --enable and without the service link: does nothing.
echo "HS_USER=$(id -un)" > "$t/env"
env HS_ENV_FILE=$t/env HS_TEST_UID=0 HS_SERVICE_DIR=$t/svoff HS_NTFY_OPT=$t/opt HS_NTFY_DATA=$t/data HS_NTFY_CONF=$t/conf sh "$SETUP" > "$t/out" 2>&1 || { cat "$t/out"; fail "setup run"; }
[ ! -e "$t/opt" ] && [ ! -e "$t/data" ] && [ ! -e "$t/conf" ] && [ ! -s "$t/out" ] || fail "setup not a no-op"
echo "ok: hs-notify"
