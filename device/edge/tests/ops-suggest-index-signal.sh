#!/bin/sh
# Test of ops-suggest-index's signal before/after (issue 143) with a stub ops-suggest-signals: a done
# optimization/quality proposal citing a signal gets "segnale sig-X: prima N, dopo M" (before = the
# 7 days ending at Opened:, after = today); no line for a rejected one, one citing no known signal, a
# non-optimization one, or one still open. And every id of ops-suggest-signals has a main value.
# From the repo root, on the Edge (needs /opt/hs-tracker/issues.js): device/edge/tests/ops-suggest-index-signal.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }

# Stub: the value depends on HS_SIGNALS_NOW (unset = today); it counts its calls.
{
	echo '#!/bin/sh'
	echo "echo x >> $t/calls"
	echo 'case "${HS_SIGNALS_NOW:-}" in'
	echo "2026-10-10) echo '[{\"id\":\"sig-cost-7d\",\"over\":true,\"usd\":12.5},{\"id\":\"sig-lint-repeat\",\"over\":true,\"kinds14d\":[{\"kind\":\"a\",\"count\":2},{\"kind\":\"b\",\"count\":4}]}]' ;;"
	echo "'') echo '[{\"id\":\"sig-cost-7d\",\"over\":false,\"usd\":6},{\"id\":\"sig-lint-repeat\",\"over\":false,\"kinds14d\":[]}]' ;;"
	echo "*) echo '[]' ;;"
	echo 'esac'
} > "$t/signals"
chmod +x "$t/signals"
mkdir -p "$t/i/open" "$t/i/done" "$t/i/proposed"
p() { # state file labels opened body
	printf '# T %s\n\nOpened: %s\nStatus: todo\nBlocked on: -\nLabels: %s\nSource: system\n\n%s\n' "$2" "$4" "$3" "$5" > "$t/i/$1/$2.md"; }
p done 001-cost proposed,optimization 2026-10-10 'Problema: sig-cost-7d è sopra soglia (sig-nope prima).'
p done 002-lint quality '2026-10-10 09:00' 'Vedi sig-xyz e poi sig-lint-repeat.'
p done 003-rej optimization,scartata 2026-10-10 'sig-cost-7d'
p done 004-none optimization 2026-10-10 'nessun segnale'
p done 005-feat feature 2026-10-10 'sig-cost-7d'
p open 006-open optimization 2026-10-10 'sig-cost-7d'
p done 007-old optimization 2026-09-01 'sig-cost-7d'
out=$(HS_INDEX_SIGNALS=$t/signals "$R/device/edge/debian/ops-suggest-index" "$t/i")
sg() { echo "$out" | jq -r --arg id "$1" '.index[] | select(.id == $id) | .signal // "-"'; }
check "cost before/after" "$(sg 001)" "segnale sig-cost-7d: prima 12.5, dopo 6"
check "first known id, max kind count" "$(sg 002)" "segnale sig-lint-repeat: prima 4, dopo 0"
check "rejected: none" "$(sg 003)" "-"
check "no signal cited: none" "$(sg 004)" "-"
check "feature: none" "$(sg 005)" "-"
check "still open: none" "$(sg 006)" "-"
check "no data: n/d" "$(sg 007)" "segnale sig-cost-7d: prima n/d, dopo 6"
check "one signals run per date" "$(wc -l < "$t/calls" | tr -d ' ')" 3
# Every signal id of ops-suggest-signals has a main value in the index.
for id in $(grep -o "sig('sig-[a-z0-9-]*'" "$R/device/edge/debian/ops-suggest-signals" | cut -d"'" -f2 | sort -u); do
	grep -q "'$id':" "$R/device/edge/debian/ops-suggest-index" || { echo "FAIL $id has no main value"; fail=1; }
done
[ $fail = 0 ] && echo "ok: ops-suggest-index signal" || exit 1
