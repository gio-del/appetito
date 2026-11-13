#!/bin/sh
# Test of studio-backup (issue 461) with a throwaway age key and study folder.
# Run from the repo root: device/edge/tests/studio-backup.sh
set -eu
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
S=device/edge/debian/studio-backup
mkdir -p "$t/h/studio/programma" "$t/h/.local/state" "$t/h/.claude" "$t/out"
echo piano > "$t/h/studio/programma/a.md"; echo x > "$t/h/.claude/secret"
git --git-dir="$t/h/.local/state/studio.git" --work-tree="$t/h/studio" init -q -b main
age-keygen -o "$t/key" 2> /dev/null; age-keygen -y "$t/key" > "$t/rcpt"
sed "s|^\. /etc/home-server.env|HS_USER=$(id -un)|; s|chown .*|true|" $S > "$t/run"
run() { STUDIO_HOME="$1" HS_BACKUP_OUT="$t/out" HS_BACKUP_RECIPIENT="$t/rcpt" sh "$t/run"; }
run "$t/nobody"
[ -z "$(ls "$t/out")" ] || { echo "FAIL: backup made without a study folder"; exit 1; }
touch "$t/out/vaultwarden-x.age" "$t/out/library-x.age"
for i in $(seq 1 15); do touch -d "2020-01-$(printf %02d "$i")" "$t/out/studio-2020010$i.tar.gz.age" 2> /dev/null || true; done
run "$t/h"
f=$(ls -1t "$t/out"/studio-*.tar.gz.age | head -n 1)
list=$(age -d -i "$t/key" "$f" | tar -tzf -)
echo "$list" | grep -q 'studio/studio/programma/a.md' || { echo "FAIL: programme not archived"; exit 1; }
echo "$list" | grep -q 'studio/studio.git/HEAD' || { echo "FAIL: git history not archived"; exit 1; }
echo "$list" | grep -q 'claude\|secret' && { echo "FAIL: .claude archived"; exit 1; }
[ "$(ls "$t/out"/studio-*.tar.gz.age | wc -l)" -le 14 ] || { echo "FAIL: not pruned"; exit 1; }
[ -e "$t/out/vaultwarden-x.age" ] && [ -e "$t/out/library-x.age" ] || { echo "FAIL: touched other backups"; exit 1; }
echo "ok: studio-backup"
