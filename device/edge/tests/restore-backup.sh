#!/bin/sh
# Test of scripts/restore-backup (issue 319): makes one backup of each type with the real scripts
# and a throwaway age key. Run from the repo root: device/edge/tests/restore-backup.sh
set -eu
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
D=device/edge/debian
R=scripts/restore-backup
mkdir -p "$t/out" "$t/sv" "$t/set" "$t/ag" "$t/st" "$t/sdata" "$t/lib" "$t/rad" "$t/vw" "$t/repo"
age-keygen -o "$t/key" 2> /dev/null; age-keygen -y "$t/key" > "$t/rcpt"
touch "$t/sv/sumisura" "$t/sv/library"
echo 'name: x' > "$t/sdata/profile.yaml"; echo '[]' > "$t/lib/books.json"
echo 'HS_X=1' > "$t/set/settings.env"; echo '<c/>' > "$t/st/config.xml"
echo ics > "$t/rad/a.ics"
git init -q "$t/repo"; git -C "$t/repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m x
run() { # SCRIPT, env via caller
	sed "s|^\. /etc/home-server.env|HS_USER=$(id -un)|; s|chown .*|true|" "$D/$1" > "$t/run-$1"
}
export HS_BACKUP_OUT="$t/out" HS_BACKUP_RECIPIENT="$t/rcpt" HS_SERVICE_DIR="$t/sv"
run sumisura-backup; HS_SUMISURA_DATA="$t/sdata" sh "$t/run-sumisura-backup"
run library-backup; HS_LIBRARY_DATA="$t/lib" sh "$t/run-library-backup"
run state-backup; HS_STATE_SETTINGS="$t/set" HS_STATE_ADGUARD="$t/ag" HS_STATE_SYNCTHING="$t/st" sh "$t/run-state-backup"
# the other three have fixed paths: build the same archives by hand, same layout
mkdir "$t/w1" "$t/w1/vaultwarden"; echo db > "$t/w1/vaultwarden/db.sqlite3"
tar -C "$t/w1" -czf - vaultwarden | age -R "$t/rcpt" -o "$t/out/vaultwarden-20260101-0300.tar.gz.age"
mkdir "$t/w2"; cp -a "$t/rad" "$t/w2/radicale"
tar -C "$t/w2" -czf - radicale | age -R "$t/rcpt" -o "$t/out/radicale-20260101-0300.tar.gz.age"
git -C "$t/repo" bundle create "$t/repo.bundle" --all 2> /dev/null
age -R "$t/rcpt" -o "$t/out/repo-20260101-0300.bundle.age" "$t/repo.bundle"
export HS_RESTORE_DIR="$t/out" HS_RESTORE_KEY="$t/key"
l=$(sh $R list)
for ty in vaultwarden radicale repo sumisura library state; do
	echo "$l" | grep -q "^$ty .*[0-9]" || { echo "FAIL: list misses $ty"; exit 1; }
done
sh $R check > /dev/null || { echo "FAIL: check on good backups"; exit 1; }
sh $R extract sumisura "$t/x1" > /dev/null
[ -s "$t/x1/sumisura-data/profile.yaml" ] || { echo "FAIL: extract sumisura"; exit 1; }
sh $R extract repo "$t/x2" > /dev/null
[ -s "$t/x2/repo.bundle" ] || { echo "FAIL: extract repo"; exit 1; }
sh $R extract state "$(ls "$t/out"/state-*.age | head -n 1)" "$t/x3" > /dev/null
[ -s "$t/x3/state/settings/settings.env" ] || { echo "FAIL: extract state with file"; exit 1; }
if sh $R extract state "$t/x3" 2> /dev/null; then echo "FAIL: non-empty destination accepted"; exit 1; fi
# corrupted archive, then missing expected file
cp "$t/out/library-"*.age "$t/lib.keep"
echo junk > "$(ls "$t/out"/library-*.age)"
if sh $R check > /dev/null 2>&1; then echo "FAIL: corrupt archive passed"; exit 1; fi
mv "$t/lib.keep" "$(ls "$t/out"/library-*.age)"
mkdir "$t/w3" "$t/w3/sumisura-data"; echo x > "$t/w3/sumisura-data/other"
tar -C "$t/w3" -czf - sumisura-data | age -R "$t/rcpt" -o "$t/out/sumisura-29991231-2359.tar.gz.age"
if sh $R check > /dev/null 2>&1; then echo "FAIL: missing expected file passed"; exit 1; fi
echo "ok: restore-backup"
