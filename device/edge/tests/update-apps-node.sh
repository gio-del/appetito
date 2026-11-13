#!/bin/sh
# Test of update-apps' Node.js branch (issue 152): fake nodejs.org, throwaway /opt/node, stub sv.
# Run from the repo root: device/edge/tests/update-apps-node.sh
set -eu
UA=$PWD/device/edge/debian/update-apps
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/path" "$t/svc" "$t/dl/v22.9.9" "$t/dl/v23.0.0" "$t/opt/node/bin"
ver() { printf '#!/bin/sh\necho %s\n' "$1" > "$2"; chmod 755 "$2"; }
ver v22.9.0 "$t/opt/node/bin/node"
for v in v22.9.9 v23.0.0; do
	mkdir -p "$t/src/node-$v-linux-arm64/bin"; ver $v "$t/src/node-$v-linux-arm64/bin/node"
	tar -cJf "$t/dl/$v/node-$v-linux-arm64.tar.xz" -C "$t/src" "node-$v-linux-arm64"
	(cd "$t/dl/$v" && sha256sum "node-$v-linux-arm64.tar.xz" > SHASUMS256.txt)
done
echo '[{"version":"v23.0.0","date":"2026-10-20"},{"version":"v22.9.9","date":"2026-10-18"},{"version":"v22.9.0","date":"2026-09-01"}]' > "$t/dl/index.json"
# curl [-fsSL] [-o FILE] URL: files under $t/dl by URL path (https://nodejs.org/dist/...).
cat > "$t/path/curl" <<C
#!/bin/sh
out=; while [ \$# -gt 1 ]; do [ "\$1" = -o ] && { out=\$2; shift; }; shift; done
p=$t/dl/\${1#https://nodejs.org/dist/}; [ -f "\$p" ] || exit 22
if [ -n "\$out" ]; then cp "\$p" "\$out"; else cat "\$p"; fi
C
printf '#!/bin/sh\necho "$@" >> "%s/sv.log"\n' "$t" > "$t/path/sv"
printf '#!/bin/sh\n' > "$t/path/npm"
chmod 755 "$t/path/curl" "$t/path/sv" "$t/path/npm"
touch "$t/svc/tracker"
run() { HS_TEST_UID=0 HS_NODE_DIR=$t/opt/node HS_SERVICE_DIR=$t/svc PATH=$t/path:$PATH "$UA" "$@" > "$t/log" 2>&1 && echo 0 || echo $?; }
nv() { "$t/opt/node/bin/node"; }
fail() { echo "FAIL: update-apps node: $*"; cat "$t/log"; exit 1; }
# 1. wrong line, or not a version: /opt/node untouched.
run --apply node v23.0.0 >/dev/null; [ "$(nv)" = v22.9.0 ] && [ ! -e "$t/opt/node.prev" ] || fail "wrong line"
run --apply node 'v22.9.9;x' >/dev/null; [ "$(nv)" = v22.9.0 ] || fail "bad version"
# 2. checksum that does not match: untouched.
sed -i 's/^[0-9a-f]*/0000000000000000000000000000000000000000000000000000000000000000/' "$t/dl/v22.9.9/SHASUMS256.txt"
run --apply node v22.9.9 >/dev/null; [ "$(nv)" = v22.9.0 ] && [ ! -e "$t/opt/node.prev" ] && grep -q FAILED "$t/log" || fail "bad checksum"
(cd "$t/dl/v22.9.9" && sha256sum node-v22.9.9-linux-arm64.tar.xz > SHASUMS256.txt)
# 3. --status lists the candidate; a plain check changes nothing.
run >/dev/null; grep -q "UPDATE   node v22.9.0 -> v22.9.9" "$t/log" || fail "report"
HS_UPDATES_OUT=$t/cand run >/dev/null; jq -e 'select(.app == "node" and .new == "v22.9.9" and .published == "2026-10-18")' "$t/cand" >/dev/null || fail "candidate"
# 4. good apply: new runtime, old one kept, services restarted.
: > "$t/sv.log"
[ "$(run --apply node v22.9.9)" = 0 ] && [ "$(nv)" = v22.9.9 ] && [ "$("$t/opt/node.prev/bin/node")" = v22.9.0 ] && grep -q "svc/tracker" "$t/sv.log" || fail "apply"
# 5. rollback.
: > "$t/sv.log"
[ "$(run --rollback node)" = 0 ] && [ "$(nv)" = v22.9.0 ] && [ ! -e "$t/opt/node.prev" ] && grep -q "svc/tracker" "$t/sv.log" || fail "rollback"
[ "$(run --rollback node)" = 1 ] && [ "$(nv)" = v22.9.0 ] || fail "rollback without previous"
echo "ok: update-apps node"
