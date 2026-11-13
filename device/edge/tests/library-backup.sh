#!/bin/sh
# Test of library-backup (issue 222) with a throwaway age key and data dir.
# Run from the repo root: device/edge/tests/library-backup.sh
set -eu
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
S=device/edge/debian/library-backup
mkdir -p "$t/data/covers" "$t/out" "$t/sv"
echo '[{"isbn":"1"}]' > "$t/data/books.json"; echo x > "$t/data/covers/1.jpg"
mkdir -p "$t/data/build" "$t/data/.claude"; echo junk > "$t/data/build/x"; echo junk > "$t/data/.claude/y"
age-keygen -o "$t/key" 2> /dev/null; age-keygen -y "$t/key" > "$t/rcpt"
sed "s|^\. /etc/home-server.env|HS_USER=$(id -un)|; s|chown .*|true|" $S > "$t/run"
env() { HS_LIBRARY_DATA="$t/data" HS_BACKUP_OUT="$t/out" HS_BACKUP_RECIPIENT="$t/rcpt" HS_SERVICE_DIR="$t/sv" sh "$t/run"; }
env
[ -z "$(ls "$t/out")" ] || { echo "FAIL: backup made while the service is disabled"; exit 1; }
touch "$t/sv/library"
# stale files: 15 old ones are pruned to 14 in total, vaultwarden-* untouched
for i in $(seq 1 15); do touch -d "2020-01-$(printf %02d "$i")" "$t/out/library-2020010$i.tar.gz.age" 2> /dev/null || true; done
touch "$t/out/vaultwarden-x.age"
env
f=$(ls -1t "$t/out"/library-*.tar.gz.age | head -n 1)
age -d -i "$t/key" "$f" | tar -tzf - | grep -q 'library/covers/1.jpg' || { echo "FAIL: archive content"; exit 1; }
age -d -i "$t/key" "$f" | tar -xzOf - library/books.json | grep -q '"isbn"' || { echo "FAIL: books.json"; exit 1; }
if age -d -i "$t/key" "$f" | tar -tzf - | grep -qE 'build|\.claude'; then echo "FAIL: junk archived"; exit 1; fi
[ "$(ls "$t/out"/library-*.tar.gz.age | wc -l)" -le 14 ] || { echo "FAIL: not pruned"; exit 1; }
[ -e "$t/out/vaultwarden-x.age" ] || { echo "FAIL: touched vaultwarden"; exit 1; }
echo '{bad' > "$t/data/books.json"
if env 2> /dev/null; then echo "FAIL: bad json accepted"; exit 1; fi
echo "ok: library-backup"
