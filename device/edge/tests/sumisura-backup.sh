#!/bin/sh
# Test of sumisura-backup (issue 310) with a throwaway age key and data dir.
# Run from the repo root: device/edge/tests/sumisura-backup.sh
set -eu
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
S=device/edge/debian/sumisura-backup
mkdir -p "$t/data/experience" "$t/out" "$t/sv"
echo 'name: Test' > "$t/data/profile.yaml"; echo x > "$t/data/experience/a.md"; echo y > "$t/data/skip.tmp"
age-keygen -o "$t/key" 2> /dev/null; age-keygen -y "$t/key" > "$t/rcpt"
sed "s|^\. /etc/home-server.env|HS_USER=$(id -un)|; s|chown .*|true|" $S > "$t/run"
env() { HS_SUMISURA_DATA="$t/data" HS_BACKUP_OUT="$t/out" HS_BACKUP_RECIPIENT="$t/rcpt" HS_SERVICE_DIR="$t/sv" sh "$t/run"; }
env
[ -z "$(ls "$t/out")" ] || { echo "FAIL: backup made while the service is disabled"; exit 1; }
touch "$t/sv/sumisura"
for i in $(seq 1 15); do touch -d "2020-01-$(printf %02d "$i")" "$t/out/sumisura-2020010$i.tar.gz.age" 2> /dev/null || true; done
touch "$t/out/library-x.age"
env
f=$(ls -1t "$t/out"/sumisura-*.tar.gz.age | head -n 1)
age -d -i "$t/key" "$f" | tar -tzf - | grep -q 'sumisura-data/experience/a.md' || { echo "FAIL: archive content"; exit 1; }
age -d -i "$t/key" "$f" | tar -tzf - | grep -q 'skip.tmp' && { echo "FAIL: tmp file included"; exit 1; }
age -d -i "$t/key" "$f" | tar -xzOf - sumisura-data/profile.yaml | grep -q 'name: Test' || { echo "FAIL: profile.yaml"; exit 1; }
[ "$(ls "$t/out"/sumisura-*.tar.gz.age | wc -l)" -le 14 ] || { echo "FAIL: not pruned"; exit 1; }
[ -e "$t/out/library-x.age" ] || { echo "FAIL: touched library"; exit 1; }
before=$(ls -A "$t/out" | wc -l)
: > "$t/data/profile.yaml"
if env 2> /dev/null; then echo "FAIL: empty profile accepted"; exit 1; fi
rm -rf "$t/data"
if env 2> /dev/null; then echo "FAIL: missing data accepted"; exit 1; fi
[ "$(ls -A "$t/out" | wc -l)" = "$before" ] || { echo "FAIL: leftover files"; exit 1; }
echo "ok: sumisura-backup"
