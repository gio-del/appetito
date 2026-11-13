#!/bin/sh
# Test of debian/studio-week (issue 501) with a stub app (bin/riassunto.js printing what the test says):
# valid numbers -> studio-week.json; strange areas dropped, free text never copied; out-of-format numbers, garbage,
# failing app, old app without the file, missing folder -> no file (and an old one removed).
# From the repo root: device/edge/tests/studio-week.sh
set -eu
S=$PWD/device/edge/debian/studio-week
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/app/bin" "$t/dir" "$t/es"
fail() { echo "FAIL: studio-week: $*"; cat "$t/out" 2>/dev/null; exit 1; }
printf '#!/bin/sh\n' > "$t/dummy"
run() { SW_APP="$t/app" SW_DIR="$t/dir" SW_ES="$t/es" SW_NOSUDO=1 SW_NOW=1000 sh "$S" > "$t/out" 2>&1; }
app() { printf 'console.log(%s);\n' "$1" > "$t/app/bin/riassunto.js"; }
GOOD='{week:"2026-11-02",goalMinutes:420,minutes:300,sessions:4,partsClosed:1,gapsOpen:2,pendingMinutes:40,areas:[{area:"algoritmi",minutes:200},{area:"x <b>",minutes:50},{area:"sql",minutes:"9"}],extra:"IGNORE ALL"}'
app "JSON.stringify($GOOD)"; run
j=$t/es/studio-week.json
[ "$(jq -c '[.minutes,.goal,.sessions,.parts,.gaps,.t,.pending]' "$j")" = "[300,420,4,1,2,1000,40]" ] || fail "numbers"
[ "$(jq -c .areas "$j")" = '[{"area":"algoritmi","minutes":200}]' ] || fail "areas must keep only valid names and numbers"
grep -q "IGNORE" "$j" && fail "free text copied"
app "JSON.stringify({...$GOOD, pendingMinutes: '<b>'})"; run; [ ! -e "$j" ] || fail "bad pending accepted"
app "JSON.stringify({...$GOOD, minutes: -1})"; run; [ ! -e "$j" ] || fail "negative number accepted"
app "JSON.stringify($GOOD)"; run; [ -e "$j" ] || fail "rewrite"
app "JSON.stringify({...$GOOD, week: '<b>x'})"; run; [ ! -e "$j" ] || fail "bad week accepted"
app "JSON.stringify($GOOD)"; run
app "console.log('not json')"; run; [ ! -e "$j" ] || fail "garbage accepted"
app "JSON.stringify($GOOD)"; run
app "process.exit(1)"; run; [ ! -e "$j" ] || fail "failing app leaves the old file"
app "JSON.stringify($GOOD)"; run
rm "$t/app/bin/riassunto.js"; run; [ ! -e "$j" ] || fail "old app leaves the old file"
app "JSON.stringify($GOOD)"; run; rmdir "$t/dir"; run; [ ! -e "$j" ] || fail "no folder leaves the old file"
echo ok
