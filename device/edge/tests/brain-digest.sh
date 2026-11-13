#!/bin/sh
# Test of brain-digest (issue 414) with throwaway dirs and stubbed brain-cal / hs-setting / ai-run:
# alive.json, part.json once a day from 30 min
# before the send time (agenda, tasks, Inbox, summary), nothing when the digest is off / weekend / no brain section,
# no model call without "riassunto", weekly repeats (issue 466). Offline.
# From the repo root: device/edge/tests/brain-digest.sh
set -eu
S=$(pwd)/device/edge/debian/brain-digest
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }
P=$(pwd)/device/edge/debian/brain/digest-prompt.md
H=$t/home B=$t/bin O=$t/out
mkdir -p "$H/vault/Inbox" "$H/vault/Impostazioni" "$H/vault/Daily" "$B" "$O"
cat > "$H/vault/Impostazioni/Second brain.md" <<'X'
---
quota_settimanale_max: 30
---
## Mail riassuntiva
- **Orario:** 07:30
- Weekend: silenzio
- Sezioni: agenda, Attività, inbox, riassunto, sicurezza, cose che aspettano te, boh
X
echo x > "$H/vault/Inbox/nota.md"; echo x > "$H/vault/Daily/oggi.md"
cat > "$B/hs-setting" <<'X'
#!/bin/sh
case $1 in HS_DIGEST_ENABLED) cat "$FAKE/enabled" ;; HS_DIGEST_WEEKEND) cat "$FAKE/weekend" ;; HS_DIGEST_HOUR) echo 7 ;; *) exit 1 ;; esac
X
cat > "$B/brain-cal" <<'X'
#!/bin/sh
if [ "$2" = calendario ]; then
printf 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Dentista\r\nDTSTART;TZID=Europe/Rome:20261104T153000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Altro giorno\r\nDTSTART;VALUE=DATE:20261105\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:c\r\nSUMMARY:Compleanno Anna\r\nDTSTART;VALUE=DATE:19900411\r\nRRULE:FREQ=YEARLY\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:d\r\nSUMMARY:Compleanno Luca\r\nDTSTART;VALUE=DATE:19901104\r\nRRULE:FREQ=YEARLY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
else
printf 'BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nSUMMARY:Pagare bolletta\r\nDUE;VALUE=DATE:20261103\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO\r\nBEGIN:VTODO\r\nSUMMARY:Fatto gia\r\nDUE;VALUE=DATE:20261103\r\nSTATUS:COMPLETED\r\nEND:VTODO\r\nBEGIN:VTODO\r\nSUMMARY:Domani\r\nDUE;VALUE=DATE:20261105\r\nEND:VTODO\r\nEND:VCALENDAR\r\n'
fi
X
cat > "$B/ai-run" <<'X'
#!/bin/sh
echo run >> "$FAKE/ai-calls"
printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"result":"- Ieri hai lavorato al server.\nVedi https://evil.example/x ora"}'
X
chmod +x "$B"/*; mkdir -p "$t/fake"; echo 1 > "$t/fake/enabled"; echo 0 > "$t/fake/weekend"
WED=$(date -u -d '2026-11-04 08:00' +%s); SAT=$(date -u -d '2026-11-07 08:00' +%s)
run() { env HOME=$H FAKE=$t/fake BRAIN_DIGEST_DIR=$O BRAIN_DIGEST_NOW=$1 BRAIN_DIGEST_PROMPT=$P BRAIN_CAL=$B/brain-cal HS_AI_RUN=$B/ai-run HS_SETTING=$B/hs-setting PATH=$B:$PATH TZ=UTC sh "$S"; }

run $((WED - 3600 * 3)) # 05:00: alive only
jq -e '.updated == $ENVV' --argjson ENVV $((WED - 3600 * 3)) "$O/alive.json" > /dev/null || fail "alive: $(cat "$O/alive.json")"
[ ! -e "$O/settings.json" ] || fail "settings.json still written"
[ ! -e "$O/part.json" ] || fail "part written too early"
run $((WED - 3600)) # 07:00: not yet (07:00 < 07:30 - 30? equal -> due)
[ -e "$O/part.json" ] || fail "no part at 07:00 (30 min before 07:30)"
[ "$(jq -r .day "$O/part.json")" = 2026-11-04 ] || fail "day"
[ "$(jq -r '.sections[] | select(.key=="agenda") | .items[].text' "$O/part.json" | tr '\n' '|')" = "Compleanno Luca|15:30 Dentista|" ] || fail "agenda: $(jq -c . "$O/part.json")"
[ "$(jq -r '.sections[] | select(.key=="attivita") | .items[].text' "$O/part.json" | tr '\n' '|')" = "Pagare bolletta (scaduta)|" ] || fail "tasks"
[ "$(jq -r '.sections[] | select(.key=="inbox") | .items[].text' "$O/part.json")" = nota.md ] || fail "inbox"
jq -e '.sections[] | select(.key=="riassunto") | .items[0].text | startswith("Ieri")' "$O/part.json" > /dev/null || fail "summary"
[ "$(wc -l < "$t/fake/ai-calls")" = 1 ] || fail "ai calls"
run $((WED + 600)); [ "$(wc -l < "$t/fake/ai-calls")" = 1 ] || fail "part rebuilt the same day"
# Weekend off on the settings page; digest off.
run $SAT; [ "$(jq -r .day "$O/part.json")" = 2026-11-04 ] || fail "part on Saturday"
echo 0 > "$t/fake/enabled"; run $((WED + 86400)); [ "$(jq -r .day "$O/part.json")" = 2026-11-04 ] || fail "part while the digest is off: $(jq -r .day "$O/part.json")"
echo 1 > "$t/fake/enabled"; echo 1 > "$t/fake/weekend"
# Weekly events (issue 466): BYDAY, INTERVAL, UNTIL, COUNT, EXDATE, a start in the future, the DST change.
cat > "$B/brain-cal-w" <<'X'
#!/bin/sh
ev() { printf 'BEGIN:VEVENT\r\nSUMMARY:%s\r\nDTSTART;TZID=Europe/Rome:%s\r\n%bEND:VEVENT\r\n' "$1" "$2" "$3"; }
printf 'BEGIN:VCALENDAR\r\n'
ev W1 20261028T180000 'RRULE:FREQ=WEEKLY\r\n'
ev W2 20261102T090000 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE\r\n'
ev W3 20261111T100000 'RRULE:FREQ=WEEKLY;BYDAY=WE\r\n'
ev W4 20261028T100000 'RRULE:FREQ=WEEKLY;UNTIL=20261104T235959Z\r\n'
ev W5 20261028T110000 'RRULE:FREQ=WEEKLY;COUNT=2\r\n'
ev W6 20261028T120000 'RRULE:FREQ=WEEKLY\r\nEXDATE;TZID=Europe/Rome:20261104T120000\r\n'
ev W7 20261018T100000 'RRULE:FREQ=WEEKLY\r\n'
printf 'END:VCALENDAR\r\n'
X
chmod +x "$B/brain-cal-w"
wk() { rm -f "$O/part.json"; env HOME=$H FAKE=$t/fake BRAIN_DIGEST_DIR=$O BRAIN_DIGEST_NOW=$(date -u -d "$1 08:00" +%s) BRAIN_DIGEST_PROMPT=$P BRAIN_CAL=$B/brain-cal-w HS_AI_RUN=$B/ai-run HS_SETTING=$B/hs-setting PATH=$B:$PATH TZ=UTC sh "$S"
	jq -r '.sections[] | select(.key=="agenda") | .items[].text' "$O/part.json" | sed 's/^[0-9:]* //' | sort | tr '\n' ' '; }
chk() { got=$(wk "$1"); [ "$got" = "$2" ] || fail "weekly $1: got '$got', want '$2'"; }
chk 2026-10-25 'W7 '
chk 2026-11-01 'W7 '
chk 2026-11-02 'W2 '
chk 2026-11-04 'W1 W2 W4 W5 '
chk 2026-11-05 ''
chk 2026-11-09 ''
chk 2026-11-11 'W1 W3 W6 '
chk 2026-11-16 'W2 '
echo ok
