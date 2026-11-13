#!/bin/sh
# Test of the card telling which uncommitted files block ops-auto (issue 296): `ops-auto --dirty-info`
# lists at most 3 names (+ the total) and since when, ignores issues/, and sends one hs-notify per
# block after the threshold. From the repo root: device/edge/tests/ops-auto-dirty.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
H=$t/home
mkdir -p "$H/bin" "$H/.local/bin" "$H/home-server/issues/open"
cp "$R/device/edge/debian/ops-auto" "$H/bin/"
printf '#!/bin/sh\necho "$*" >> "$HOME/notify.calls"\n' > "$t/notify"
chmod +x "$H/bin/ops-auto" "$t/notify"
printf '#!/bin/sh\necho 50\n' > "$H/.local/bin/hs-setting"; chmod +x "$H/.local/bin/hs-setting"
cd "$H/home-server"
git init -q -b main && git config user.name t && git config user.email t@t
echo base > a.txt; git add -A && git commit -qm init
export HS_QUEUE_PROJECTS_JSON= HOME="$H" HS_NOTIFY="$t/notify"
ST=$H/.local/state/ops-auto
mkdir -p "$ST"
info() { "$H/bin/ops-auto" --dirty-info; }
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }

check "clean: nothing" "$(info)" ""
echo x > issues/open/1-x.md
check "only issues/: nothing" "$(info)" ""
check "only issues/: no since" "$([ -e "$ST/dirty-since" ] && echo yes || echo no)" no
mkdir docs; echo n > docs/watch-zepp.md
check "one file: name" "$(info | jq -c '[.files, .total]')" '[["docs/watch-zepp.md"],1]'
check "since written" "$([ -s "$ST/dirty-since" ] && echo yes || echo no)" yes
check "no notice yet" "$([ -e "$H/notify.calls" ] && echo yes || echo no)" no
touch b c d e
check "more than 3: 3 names, total 5" "$(info | jq -c '[(.files | length), .total]')" '[3,5]'
echo $(($(date +%s) - 4 * 3600)) > "$ST/dirty-since"
check "since kept" "$(info | jq '.since')" "$(cat "$ST/dirty-since")"
check "one notice after 3 h" "$(grep -c 'fermo da 3 ore.*(+2 altri)' "$H/notify.calls")" 1
info > /dev/null
check "no second notice" "$(grep -c . "$H/notify.calls")" 1
git add -A && git commit -qm all
check "committed: nothing" "$(info)" ""
check "committed: state reset" "$([ -e "$ST/dirty-since" ] || [ -e "$ST/dirty-notified" ] && echo yes || echo no)" no
exit $fail
