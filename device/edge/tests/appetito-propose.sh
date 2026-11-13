#!/bin/sh
# Test of the Appetito proposals (issue 487): only tracked files outside appetito/files and
# appetito/private become proposals, one each; a file named by any issue (proposed, open, done =
# rejected) is never proposed again; the pending cap and --max limit a round. Temp repos only.
# From the repo root: device/edge/tests/appetito-propose.sh
set -eu
P=$(pwd)/scripts/appetito-propose
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
g() { git -C "$t/src" -c user.name=t -c user.email=t@t -c core.hooksPath=/dev/null "$@"; }
mkdir -p "$t/src/pub" "$t/src/priv" "$t/src/appetito" "$t/src/issues/proposed" "$t/src/issues/done" "$t/src/issues/open" "$t/src/new"
git -C "$t/src" init -q -b main
cp "$(pwd)/scripts/appetito-build" "$t/src/appetito-build"; mkdir -p "$t/s"; cp "$(pwd)/scripts/appetito-build" "$(pwd)/scripts/appetito-check" "$t/s/" 2>/dev/null || true
echo a > "$t/src/pub/a.txt"; echo s > "$t/src/priv/s.txt"; echo n > "$t/src/new/n1.txt"; echo n > "$t/src/new/n2.txt"; echo n > "$t/src/new/n3.txt"
printf 'pub/\n' > "$t/src/appetito/files"; printf '# privati\npriv/\nissues/\nappetito/\nappetito-build\n' > "$t/src/appetito/private"
g add -A; g commit -q -m one
# scripts/ of the temp repo: the real tool next to the real generator
cp "$P" "$t/s/appetito-propose"; mkdir -p "$t/s/.."; 
post="cat >> $t/posted.jsonl; echo >> $t/posted.jsonl"
run() { APPETITO_POST="$post" sh "$t/s/appetito-propose" --repo "$t/src" "$@"; }
: > "$t/posted.jsonl"
run --max 2 > "$t/o1" || fail "run 1: $(cat "$t/o1")"
[ "$(grep -c '"title"' "$t/posted.jsonl")" = 2 ] || fail "--max 2 not respected: $(cat "$t/posted.jsonl")"
grep -q 'priv/s.txt\|pub/a.txt' "$t/posted.jsonl" && fail "listed or private file proposed"
jq -e '.labels | index("afk")' "$t/posted.jsonl" >/dev/null || fail "label afk missing"
# Two proposals are now waiting (written by the tracker, here by hand); one rejected, one open.
printf '# x\n\nSource: system\nAppetito: new/n1.txt\n' > "$t/src/issues/proposed/900-a.md"
printf '# y\n\nLabels: scartata\nAppetito: new/n2.txt\n' > "$t/src/issues/done/901-b.md"
: > "$t/posted.jsonl"
run > "$t/o2"; [ "$(grep -c '"title"' "$t/posted.jsonl")" = 1 ] || fail "only n3 left: $(cat "$t/posted.jsonl")"
grep -q 'new/n3.txt' "$t/posted.jsonl" || fail "n3 not proposed"
printf '# z\n\nAppetito: new/n3.txt\n' > "$t/src/issues/open/902-c.md"
: > "$t/posted.jsonl"; run > "$t/o3"
[ ! -s "$t/posted.jsonl" ] || fail "decided files proposed again"
# Pending cap: no room left.
printf '# x\n\nSource: system\nAppetito: q1\n' > "$t/src/issues/proposed/903-d.md"
: > "$t/posted.jsonl"; run --pending-max 1 > "$t/o4"; [ ! -s "$t/posted.jsonl" ] || fail "pending cap ignored"
echo ok
