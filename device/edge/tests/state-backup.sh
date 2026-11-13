#!/bin/sh
# Test of state-backup (issue 311) with a throwaway age key and state dirs.
# Run from the repo root: device/edge/tests/state-backup.sh
set -eu
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
S=device/edge/debian/state-backup
mkdir -p "$t/set" "$t/ag" "$t/st" "$t/out" "$t/secrets" "$t/vault"
echo 'HS_X=1' > "$t/set/settings.env"; echo 'users: []' > "$t/ag/AdGuardHome.yaml"
echo '<configuration/>' > "$t/st/config.xml"; echo c > "$t/st/cert.pem"; echo k > "$t/st/key.pem"
echo https > "$t/st/https-key.pem"; echo idx > "$t/st/index-v2"; echo s > "$t/secrets/pw"
age-keygen -o "$t/key" 2> /dev/null; age-keygen -y "$t/key" > "$t/rcpt"
sed "s|^\. /etc/home-server.env|HS_USER=$(id -un)|; s|chown .*|true|" $S > "$t/run"
env() { HS_STATE_SETTINGS="$t/set" HS_STATE_ADGUARD="$t/ag" HS_STATE_SYNCTHING="$t/st" HS_BACKUP_OUT="$t/out" HS_BACKUP_RECIPIENT="$t/rcpt" sh "$t/run"; }
for i in $(seq 1 15); do touch -d "2020-01-$(printf %02d "$i")" "$t/out/state-2020010$i.tar.gz.age" 2> /dev/null || true; done
touch "$t/out/library-x.age"
env
f=$(ls -1t "$t/out"/state-*.tar.gz.age | head -n 1)
l=$(age -d -i "$t/key" "$f" | tar -tzf -)
for p in settings/settings.env adguardhome/AdGuardHome.yaml syncthing/config.xml syncthing/cert.pem syncthing/key.pem; do
	echo "$l" | grep -q "state/$p\$" || { echo "FAIL: $p missing"; exit 1; }
done
if echo "$l" | grep -qE 'https-key|index|secrets|vault|tailscale|pw$'; then echo "FAIL: forbidden file in archive"; exit 1; fi
[ "$(ls "$t/out"/state-*.tar.gz.age | wc -l)" -le 14 ] || { echo "FAIL: not pruned"; exit 1; }
[ -e "$t/out/library-x.age" ] || { echo "FAIL: touched other backups"; exit 1; }
# missing optional files are skipped
rm "$t/ag/AdGuardHome.yaml" "$t/set/settings.env"
env
# nothing at all: fails
rm "$t/st"/*.pem "$t/st/config.xml"
if env 2> /dev/null; then echo "FAIL: empty state accepted"; exit 1; fi
echo "ok: state-backup"
