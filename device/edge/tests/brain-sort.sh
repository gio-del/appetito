#!/bin/sh
# Test of brain-sort (issue 198) with throwaway dirs and stubbed claude/hs-setting/hs-runlog:
# a bad name (":") under Projects/Sumisura does not start a run nor reach the Riordino list,
# one elsewhere does; nothing in Projects/Sumisura is touched by the job itself.
# From the repo root: device/edge/tests/brain-sort.sh
set -eu
S=$(pwd)/device/edge/debian/brain-sort
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: $1"; exit 1; }
H=$t/home B=$t/bin
mkdir -p "$H/vault/Inbox" "$H/vault/Projects/Sumisura/CV" "$H/vault/Notes" "$B"
printf '#!/bin/sh\nexit 1\n' > "$B/hs-setting"
printf '#!/bin/sh\nexit 0\n' > "$B/hs-runlog"
cat > "$B/claude" <<'X'
#!/bin/sh
echo "$2" >> "$CLAUDE_LOG"
echo '{"type":"result","subtype":"success","is_error":false,"num_turns":1,"total_cost_usd":0}'
X
chmod +x "$B"/*
P=$H/vault/Projects/Sumisura
echo cv > "$P/CV/acme: 2026.pdf"; echo n > "$P/note: x.md"
before=$(cd "$P" && find . -type f | sort | md5sum)
touch -d '2 hours ago' "$P/CV/acme: 2026.pdf" "$P/note: x.md"
run() { HOME=$H BRAIN_ANSWERS=$t/answers CLAUDE_LOG=$t/log BRAIN_QUIET_S=60 HS_AI_RUN=${S%/brain-sort}/ai-run PATH=$B:$PATH sh -c ". /dev/null; $(sed 's|^export PATH=.*|export LANG=C.UTF-8 CLAUDE_CODE_TMPDIR=$HOME/.cache/claude-tmp|' "$S")"; }
run
[ ! -e "$t/log" ] || fail "run started for a bad name under Projects/Sumisura"
echo n > "$H/vault/Notes/bad: name.md"; touch -d '2 hours ago' "$H/vault/Notes/bad: name.md"
run
[ -e "$t/log" ] || fail "no run for a bad name elsewhere"
grep -q 'Notes/bad: name.md' "$t/log" || fail "bad name elsewhere not listed"
grep -q 'Sumisura' "$t/log" && fail "Sumisura listed for tidy"
[ "$(cd "$P" && find . -type f | sort | md5sum)" = "$before" ] || fail "Projects/Sumisura changed"
# Answer to a tracker question (issue 294): starts a run once, lists the file, not again afterwards.
mkdir -p "$t/answers"; rm -f "$t/log"
run; [ ! -e "$t/log" ] || fail "run without answers"
echo '{"id":"300","origin":"Inbox/x.md","question":"q","answer":"a"}' > "$t/answers/300.json"
run
grep -q "$t/answers/300.json" "$t/log" || fail "answer not listed"
rm -f "$t/log"; run
[ ! -e "$t/log" ] || fail "answer handled twice"
echo "ok brain-sort"
