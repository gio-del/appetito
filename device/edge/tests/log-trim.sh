#!/bin/sh
# Test of log-trim (issue 129): limit, line boundary, --keep-days, same inode, no content printed.
# From the repo root: device/edge/tests/log-trim.sh
set -eu
R=$(pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
LT="$R/device/edge/debian/log-trim"
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }

# 200 lines of 10 bytes ("line-0001\n" ...) = 2000 bytes
i=1; while [ $i -le 200 ]; do printf 'line-%04d\n' $i; i=$((i + 1)); done > "$t/a.log"
ino=$(stat -c %i "$t/a.log")
out=$(sh "$LT" 1000 "$t/a.log" "$t/missing.log")
check "under limit" "$(stat -c %s "$t/a.log")" 1000
check "same inode" "$(stat -c %i "$t/a.log")" "$ino"
check "first line whole" "$(head -n 1 "$t/a.log")" line-0101
check "last line kept" "$(tail -n 1 "$t/a.log")" line-0200
check "output: name and bytes" "$out" "log-trim: $t/a.log: -1000 byte"

# limit not on a boundary: drops the partial line
sh "$LT" 995 "$t/a.log" > /dev/null
check "partial line dropped" "$(head -n 1 "$t/a.log")" line-0102
check "size after partial" "$(stat -c %s "$t/a.log")" 990

# below the limit: untouched, silent
check "below limit silent" "$(sh "$LT" 5000 "$t/a.log")" ""
check "below limit size" "$(stat -c %s "$t/a.log")" 990

# --keep-days: old lines go, recent ones stay even above the limit
old=$(date -d '60 days ago' +%F); mid=$(date -d '40 days ago' +%F); new=$(date -d '10 days ago' +%F)
{
	i=0; while [ $i -lt 50 ]; do echo "$old 10:00:00 #001: vecchia"; i=$((i + 1)); done
	echo "$mid 10:00:00 #002: oltre 35 giorni"
	echo "riga senza data"
	i=0; while [ $i -lt 50 ]; do echo "$new 10:00:00 #003: recente"; i=$((i + 1)); done
} > "$t/ops-auto.log"
sh "$LT" --keep-days 35 100 "$t/ops-auto.log" > /dev/null
check "keep-days: recent kept" "$(grep -c "^$new" "$t/ops-auto.log")" 50
check "keep-days: old dropped" "$(grep -c -e "^$old" -e "^$mid" "$t/ops-auto.log" || true)" 0
check "keep-days: starts on dated line" "$(head -c 10 "$t/ops-auto.log")" "$new"
# --keep-days and size: the limit wins when it keeps more
cp "$t/ops-auto.log" "$t/b.log"; echo "$old x" | cat - "$t/b.log" > "$t/c.log"
sh "$LT" --keep-days 35 100000 "$t/c.log" > /dev/null
check "keep-days under limit untouched" "$(head -c 10 "$t/c.log")" "$old"

exit $fail
