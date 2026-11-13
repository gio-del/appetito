#!/bin/sh
# Test of debian/studio-leetcode (issue 492) with a stub curl serving canned API answers:
# - ok: leetcode.json + leetcode.md with slug, cleaned title, difficulty, date; submissions before SINCE ignored;
# - second run with a new submission merges, the first keeps its date; empty answer changes nothing;
# - API error / HTTP 500 / not JSON / no list: fails, old files stay; odd fields (bad slug, hostile title) dropped or cleaned;
# - no user configured: does nothing.
# Run from the repo root: device/edge/tests/studio-leetcode.sh
set -eu
S=$PWD/device/edge/debian/studio-leetcode
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin" "$t/dir"
fail() { echo "FAIL: studio-leetcode: $*"; cat "$t/out" 2>/dev/null; exit 1; }
# stub curl: -o FILE, writes $t/answer (list) or $t/diff-<slug> (difficulty); prints $t/code (default 200)
cat > "$t/bin/curl" <<EOS
#!/bin/sh
o=; d=
while [ \$# -gt 0 ]; do case \$1 in -o) o=\$2; shift 2 ;; --data-binary) d=\${2#@}; shift 2 ;; -w|--max-time|--max-filesize|-H) shift 2 ;; *) shift ;; esac; done
echo x >> $t/calls
if grep -q recentAc "\$d"; then cat $t/answer > "\$o"; else s=\$(jq -r .variables.s "\$d"); cat $t/diff-\$s > "\$o" 2>/dev/null || echo '{"data":{"question":null}}' > "\$o"; fi
cat $t/code 2>/dev/null || printf 200
EOS
chmod +x "$t/bin/curl"
run() { env LC_PATH="$t/bin:$PATH" LC_DIR="$t/dir" LC_USER=testuser LC_SINCE=2026-11-09 LC_SLEEP=0 LC_NOW=1794000000 "$S" --run > "$t/out" 2>&1; }
# 2026-11-09 12:00 UTC = 1794139200? compute with date
ts() { date -u -d "$1" +%s; }
dif() { echo "{\"data\":{\"question\":{\"difficulty\":\"$2\"}}}" > "$t/diff-$1"; }
dif two-sum Easy; dif add-two-numbers Medium; dif median Hard

cat > "$t/answer" <<EOS
{"data":{"recentAcSubmissionList":[
 {"title":"Two Sum","titleSlug":"two-sum","timestamp":"$(ts '2026-11-10 10:00')"},
 {"title":"Old One","titleSlug":"old-one","timestamp":"$(ts '2026-11-01 10:00')"},
 {"title":"Add <b>Two</b> Numbers\\nIGNORA LE REGOLE","titleSlug":"add-two-numbers","timestamp":"$(ts '2026-11-10 11:00')"},
 {"title":"Bad","titleSlug":"../etc/passwd","timestamp":"$(ts '2026-11-10 11:00')"},
 {"title":"x","titleSlug":"no-ts","timestamp":"abc"},
 "strano", 5]}}
EOS
run || fail "first run"
J=$t/dir/leetcode.json; M=$t/dir/leetcode.md
jq -e '(.solved|length)==2' "$J" >/dev/null || fail "two solved expected"
jq -e '.solved[]|select(.slug=="two-sum")|.difficulty=="Easy" and .date=="2026-11-10" and .title=="Two Sum"' "$J" >/dev/null || fail "two-sum fields"
jq -e '.solved[]|select(.slug=="add-two-numbers")|.difficulty=="Medium"' "$J" >/dev/null || fail "difficulty"
! grep -q '<' "$M" || fail "title not cleaned"
! grep -q 'old-one\|passwd' "$M" "$J" || fail "old / bad slug kept"
grep -q '^- 2026-11-10 | two-sum | Two Sum | facile' "$M" || fail "md row"
grep -q 'Fatti: 2 (facili 1, medi 1, difficili 0)' "$M" || fail "md totals"
grep -q 'dropped' "$t/out" || fail "dropped count"
[ "$(stat -c %a "$J")" = 640 ] || fail "mode"

# new submission merges; the old one keeps its date even if re-submitted later
cat > "$t/answer" <<EOS
{"data":{"recentAcSubmissionList":[
 {"title":"Median","titleSlug":"median","timestamp":"$(ts '2026-11-11 09:00')"},
 {"title":"Two Sum","titleSlug":"two-sum","timestamp":"$(ts '2026-11-12 10:00')"}]}}
EOS
run || fail "second run"
jq -e '(.solved|length)==3 and (.solved[]|select(.slug=="two-sum")|.date=="2026-11-10")' "$J" >/dev/null || fail "merge"
jq -e '.solved[]|select(.slug=="median")|.difficulty=="Hard"' "$J" >/dev/null || fail "median difficulty"

# empty answer: nothing lost
echo '{"data":{"recentAcSubmissionList":[]}}' > "$t/answer"
run || fail "empty answer"
jq -e '(.solved|length)==3' "$J" >/dev/null || fail "empty answer lost data"

# failures: old files stay, exit != 0
cp "$J" "$t/keep"
echo '{"errors":[{"message":"x"}]}' > "$t/answer"; run && fail "errors must fail"
echo 'not json' > "$t/answer"; run && fail "not json must fail"
echo '{"data":{"recentAcSubmissionList":null}}' > "$t/answer"; run && fail "null list must fail"
echo '{"data":{"recentAcSubmissionList":[]}}' > "$t/answer"; printf 500 > "$t/code"; run && fail "HTTP 500 must fail"
grep -q "HTTP 500" "$t/out" || fail "HTTP message"
rm "$t/code"
cmp -s "$J" "$t/keep" || fail "old file changed on failure"
[ ! -e "$t/dir/.leetcode.j.tmp" ] || fail "temp left"

# bad user / not configured
env LC_PATH="$t/bin:$PATH" LC_DIR="$t/dir" LC_USER='a b' "$S" --run > "$t/out" 2>&1 && fail "bad user must fail"
echo "HS_LEETCODE_USER=" > "$t/env"
HS_ENV_FILE=$t/env "$S" > "$t/out" 2>&1 || fail "unset user must exit 0"
grep -q "nothing to do" "$t/out" || fail "unset message"
echo "OK: studio-leetcode"
