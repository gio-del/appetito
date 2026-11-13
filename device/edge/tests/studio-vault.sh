#!/bin/sh
# Test of studio-vault (issue 491) with throwaway dirs, no mount, no chown, stub setfacl/id:
# - no-op while the studio service is disabled, without the vault or without the study folder;
# - enabled: Note/ and Schede/ created (2750), Studio/ mountpoint in the vault, Studio/ in the vault's .gitignore once;
# - ACLs: the owner rwX with defaults, brain read-only (rX, never rwX), nothing for studio or others in the vault, nothing outside the study folder;
# - second run changes nothing (idempotent); a link in place of the folder is refused;
# - static: brain-setup leaves Studio/ out of its rwX ACLs, cron line, deploy, boot mount, tutor rules and their installer.
# From the repo root: device/edge/tests/studio-vault.sh
set -eu
D=$(pwd)/device/edge
S=$D/debian/studio-vault
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: studio-vault: $1"; exit 1; }
mkdir -p "$t/bin" "$t/vault" "$t/home/studio/studio/programma" "$t/sv"
printf '#!/bin/sh\necho "$*" >> %s/acl.log\n' "$t" > "$t/bin/setfacl"
printf '#!/bin/sh\n[ "$1" = brain ] && exit 0\nexec /usr/bin/id "$@"\n' > "$t/bin/id"
chmod +x "$t/bin/setfacl" "$t/bin/id"
echo "HS_USER=$(id -un)" > "$t/env"
: > "$t/vault/.gitignore"
F=$t/home/studio/studio
run() { PATH=$t/bin:$PATH HS_USER=$(id -un) SV_VAULT=$t/vault SV_STUDIO_HOME=$t/home/studio SV_SERVICE_DIR=$t/sv SV_NOMOUNT=1 SV_AS_SELF=1 sh "$S"; }

run
[ ! -e "$F/Note" ] && [ ! -e "$t/vault/Studio" ] && [ ! -e "$t/acl.log" ] || fail "did something while the service is disabled"
ln -s "$t/sv" "$t/sv/studio"
run
[ -d "$F/Note" ] && [ -d "$F/Schede" ] || fail "no Note/ or Schede/"
[ "$(stat -c %a "$F/Note")" = 2750 ] || fail "Note/ mode"
[ -d "$t/vault/Studio" ] || fail "no mountpoint in the vault"
grep -qx 'Studio/' "$t/vault/.gitignore" || fail "Studio/ not in the vault's .gitignore"
me=$(id -un)
grep -qx -- "-R -m u:$me:rwX,m::rwX,d:u:$me:rwX,d:m::rwX $F" "$t/acl.log" || fail "no rwX ACL for the owner"
grep -qx -- "-R -m u:brain:rX,d:u:brain:rX $F" "$t/acl.log" || fail "no read-only ACL for brain"
! grep -q "brain:rw" "$t/acl.log" || fail "brain can write"
! grep -q "u:studio" "$t/acl.log" || fail "ACL for studio"
! grep -v " $F\$" "$t/acl.log" | grep -q . || fail "ACL outside the study folder"
run; run
[ "$(grep -c . "$t/vault/.gitignore")" = 1 ] || fail ".gitignore line repeated"
echo mine > "$F/Note/a.md"; run
[ "$(cat "$F/Note/a.md")" = mine ] || fail "owner's note touched"

rm -rf "$t/home/studio/studio"; ln -s /tmp "$t/home/studio/studio"
! run 2> /dev/null || fail "a link in place of the folder accepted"

# static
grep -q 'Studio' "$D/debian/brain-setup" && grep -q '"\$V/Studio") -prune' "$D/debian/brain-setup" || grep -q -- '-path "\$V/Studio"' "$D/debian/brain-setup" || fail "brain-setup does not prune Studio/"
grep -q 'hs-run studio-vault /usr/local/sbin/studio-vault' "$D/debian/cron.d-home-server" || fail "no cron line"
grep -q '"\$D/studio-vault"' "$D/deploy" && grep -q 'sudo /usr/local/sbin/studio-vault' "$D/deploy" || fail "deploy does not install/run it"
grep -q 'srv/vault/Studio' "$D/debian/debian.sh" || fail "no boot mount"
grep -q '^## Note e schede' "$D/debian/studio/CLAUDE.md" || fail "no tutor section"
grep -q 'Note e schede' "$D/debian/studio-setup" || fail "studio-setup does not install the section"
echo "studio-vault: ok"
