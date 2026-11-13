#!/bin/sh
# Test of sumisura-vault (issue 167) with throwaway dirs, no mount, no runuser: folders and
# .keep files; .stignore/.gitignore lines added once; CV/Lettere copies named <company-date>;
# unchanged files not rewritten, changed ones overwritten, files of others left alone; nothing
# ACLs for the tailor user (stub setfacl); nothing but the three wanted files copied (json stays out); copies of deleted outputs removed, other files kept; no-op without Projects/ in the vault.
# From the repo root: device/edge/tests/sumisura-vault.sh
set -eu
S=$(pwd)/device/edge/debian/sumisura-vault
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: $1"; exit 1; }
L=$t/lib V=$t/vault
mkdir -p "$L/data" "$L/output/acme-2026-10-01" "$L/output/beta-2026-10-02" "$V/Projects"
echo cv1 > "$L/output/acme-2026-10-01/cv.pdf"
echo cl1 > "$L/output/acme-2026-10-01/cover-letter.pdf"
echo txt > "$L/output/acme-2026-10-01/cover-letter.txt"
echo '{}' > "$L/output/acme-2026-10-01/data.json"
echo cv2 > "$L/output/beta-2026-10-02/cv.pdf"
printf '.git\n' > "$V/.stignore"; : > "$V/.gitignore"
run() { PATH=$t/bin:$PATH SV_TAILOR_USER=$(id -un) SV_LIB=$L SV_VAULT=$V SV_NOMOUNT=1 SV_AS_SELF=1 sh "$S"; }
mkdir -p "$t/bin"
printf '#!/bin/sh\necho "$*" >> "%s/acl.log"\n' "$t" > "$t/bin/setfacl"; chmod +x "$t/bin/setfacl"
P=$V/Projects/Sumisura

run
for d in CV Lettere Richieste "Master Data"; do [ -d "$P/$d" ] || fail "no $d"; done
[ -e "$P/CV/.keep" ] && [ -e "$P/Lettere/.keep" ] && [ -e "$P/Richieste/.keep" ] || fail "no .keep"
grep -q "^azienda:" "$P/Richieste/_Modello.md" || fail "no request template"
[ "$(cat "$P/CV/acme-2026-10-01.pdf")" = cv1 ] || fail "cv not copied"
[ "$(cat "$P/CV/beta-2026-10-02.pdf")" = cv2 ] || fail "second cv not copied"
[ "$(cat "$P/Lettere/acme-2026-10-01.pdf")" = cl1 ] || fail "letter pdf not copied"
[ "$(cat "$P/Lettere/acme-2026-10-01.txt")" = txt ] || fail "letter txt not copied"
[ ! -e "$P/Lettere/beta-2026-10-02.pdf" ] || fail "missing source invented"
[ -z "$(find "$P/CV" "$P/Lettere" -name '*.json' -o -name '*.tmp')" ] || fail "json or temp file in the vault"
grep -qx '/Projects/Sumisura/Master Data/applications' "$V/.stignore" || fail "stignore applications"
grep -qx '/Projects/Sumisura/Master Data/jobs' "$V/.stignore" || fail "stignore jobs"
grep -qx '/Projects/Sumisura/Master Data/pending-captures' "$V/.stignore" || fail "stignore captures"
grep -qx 'Projects/Sumisura/Master Data/' "$V/.gitignore" || fail "gitignore"

# ACLs of the tailor user (issue 273): x on the parents, rwX plus default on the three folders only.
me=$(id -un)
grep -qx -- "-m u:$me:x $V $V/Projects $P" "$t/acl.log" || fail "no x-only ACL on the parents"
for d in CV Lettere Richieste; do grep -qx -- "-R -m u:$me:rwX,d:u:$me:rwX $P/$d" "$t/acl.log" || fail "no rwX ACL on $d"; done
! grep -q "Master Data" "$t/acl.log" || fail "ACL touches Master Data"
run; run
[ "$(grep -c 'Master Data/jobs' "$V/.stignore")" = 1 ] || fail "stignore line repeated"
[ "$(grep -c . "$V/.gitignore")" = 1 ] || fail "gitignore line repeated"

echo mine > "$P/CV/own.pdf"
inode=$(ls -i "$P/CV/acme-2026-10-01.pdf")
run
[ "$(ls -i "$P/CV/acme-2026-10-01.pdf")" = "$inode" ] || fail "unchanged file rewritten"
echo cv1b > "$L/output/acme-2026-10-01/cv.pdf"
echo edited > "$P/Lettere/acme-2026-10-01.txt"
run
[ "$(cat "$P/CV/acme-2026-10-01.pdf")" = cv1b ] || fail "changed output not copied"
[ "$(cat "$P/Lettere/acme-2026-10-01.txt")" = txt ] || fail "edit in the vault not reverted (read-only copy)"
[ -e "$P/CV/.keep" ] || fail ".keep touched"

rm -rf "$L/output/beta-2026-10-02"
echo keepme > "$P/CV/notes.md"
run
[ ! -e "$P/CV/beta-2026-10-02.pdf" ] || fail "copy of deleted output kept"
[ ! -e "$P/CV/own.pdf" ] || fail "orphan copy kept"
[ -f "$P/CV/acme-2026-10-01.pdf" ] || fail "live copy removed"
[ "$(cat "$P/CV/notes.md")" = keepme ] || fail "non-copy file removed"
rm -rf "$L/output/acme-2026-10-01"
run
[ ! -e "$P/Lettere/acme-2026-10-01.txt" ] && [ ! -e "$P/Lettere/acme-2026-10-01.pdf" ] || fail "letters of deleted output kept"

rm -rf "$V/Projects"
run
[ ! -e "$V/Projects" ] || fail "created Projects in a vault without it"
echo "sumisura-vault: ok"
