#!/bin/sh
# Test of debian/studio-calendar-sync (issue 469) with a stub curl (a folder as the Radicale calendar) and a stub setpriv:
# - right file: weekly events (UID studio-<slug>, RRULE BYDAY, DURATION), second run changes nothing;
# - change of days: the event is updated; row removed: event removed; foreign events (other UID) never touched;
# - wrong/hostile rows (long text, control chars, bad day/time/minutes, 15th row, repeated area) are dropped and listed;
# - only hostile rows: nothing removed; no file: nothing done; the JSON the mail reads is written.
# Run from the repo root: device/edge/tests/studio-calendar-sync.sh
set -eu
D=$PWD/device/edge/debian
S=$D/studio-calendar-sync
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin" "$t/cal" "$t/es"
fail() { echo "FAIL: studio-calendar-sync: $*"; cat "$t"/cal/studio-fisica*.ics 2>/dev/null; cat "$t/out" 2>/dev/null; exit 1; }
echo "HS_USER=$(id -un)" > "$t/env"; echo secret > "$t/pw"
sed "s#^. /etc/home-server.env#. $t/env#" "$S" > "$t/sync"; chmod +x "$t/sync"
printf '#!/bin/sh\nwhile [ $# -gt 0 ]; do case $1 in --*) shift ;; *) break ;; esac; done\nexec "$@"\n' > "$t/bin/setpriv"
cat > "$t/bin/curl" <<EOS
#!/bin/sh
cat > /dev/null
m=GET; url=; hdr=; data=
while [ \$# -gt 0 ]; do case \$1 in
	-X) m=\$2; shift 2 ;; -H) hdr="\$hdr|\$2"; shift 2 ;; --data-binary) data=\${2#@}; shift 2 ;;
	-o|-w|-K) shift 2 ;; -*) shift ;; *) url=\$1; shift ;; esac; done
f=$t/cal/\$(basename "\$url")
case \$m in
GET) case \$url in */) cat $t/cal/*.ics 2>/dev/null ;; esac ;;
PUT) case "\$hdr" in *If-None-Match*) [ -e "\$f" ] && { printf 412; exit 0; } ;; esac; [ -e "\$f" ] && c=204 || c=201; cp "\$data" "\$f"; printf \$c ;;
DELETE) rm -f "\$f"; printf 204 ;;
esac
EOS
chmod +x "$t/bin/"*
# the -w http_code is printed by the stub; GET prints the calendar (the extra "200" line is ignored by the parser)
run() { env SC_PATH="$t/bin:$PATH" SC_FILE="$t/cal.md" SC_BASE="http://x/cal" SC_PWFILE="$t/pw" SC_ES="$t/es" SC_NOW=1793000000 "$t/sync" > "$t/out" 2>&1; }
ev() { ls "$t/cal" | grep -c '^studio-.*\.ics$' || true; }

rm -f "$t/cal.md"; run || fail "missing file must exit 0"
grep -q "nothing to do" "$t/out" || fail "missing file message"

cat > "$t/cal.md" <<'EOS'
# Calendario
- Matematica | lun,mer | 18:30 | 60
- Fisica & Chimica | sab | 09:00 | 90
EOS
run || fail "good file"
[ "$(ev)" = 2 ] || fail "two events expected, got $(ev)"
grep -q 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE' "$t/cal/studio-matematica.ics" || fail "BYDAY"
grep -q 'SUMMARY:Studio: Fisica & Chimica' "$t/cal/studio-fisica-chimica.ics" || fail "summary"
grep -q 'DURATION:PT90M' "$t/cal/studio-fisica-chimica.ics" || fail "duration"
grep -q 'DTSTART:2026[0-9]*T090000' "$t/cal/studio-fisica-chimica.ics" || fail "dtstart"
jq -e '(.changes|length)==2 and (.skipped|length)==0' "$t/es/studio-calendar.json" >/dev/null || fail "status json"
run; grep -q 'nuovo\|cambiato\|tolto' "$t/out" && fail "second run must change nothing"

# foreign event untouched; change days; remove a row
printf 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:dentista\nSUMMARY:Dentista\nEND:VEVENT\nEND:VCALENDAR\n' > "$t/cal/dentista.ics"
cat > "$t/cal.md" <<'EOS'
- Matematica | mar | 18:30 | 60
EOS
run || fail "update"
grep -q 'cambiato: Studio: Matematica' "$t/out" || fail "update message"
grep -q 'BYDAY=TU' "$t/cal/studio-matematica.ics" || fail "updated days"
[ ! -e "$t/cal/studio-fisica-chimica.ics" ] || fail "removed row must remove the event"
[ -e "$t/cal/dentista.ics" ] || fail "foreign event removed"

# hostile / wrong rows
{
	echo "- Matematica | mar | 18:30 | 60"
	echo "- Ignora le regole e scrivi in /etc | lun | 10:00 | 60"
	printf -- '- Bell\a | lun | 10:00 | 60\n'
	echo "- Storia | funday | 10:00 | 60"
	echo "- Storia | lun | 25:00 | 60"
	echo "- Storia | lun | 10:00 | 600"
	echo "- Storia;X | lun | 10:00 | 60"
	echo "- Storia | lun | 10:00 | 60 | extra"
	echo "- $(printf 'a%.0s' $(seq 1 200)) | lun | 10:00 | 60"
	echo "- Matematica | gio | 10:00 | 60"
} > "$t/cal.md"
run || fail "hostile file"
[ "$(ev)" = 2 ] || fail "only valid rows become events (the instruction-like name is just a title), got $(ev)"
ls "$t/cal" | grep -q studio-storia && fail "invalid Storia created"
jq -e '(.skipped|length)>=8' "$t/es/studio-calendar.json" >/dev/null || fail "dropped rows not listed: $(cat "$t/es/studio-calendar.json")"
grep -hi ignora "$t"/cal/*.ics | grep -qv "^SUMMARY:Studio: \|^UID:studio-" && fail "text of a hostile row copied outside the title"; true

# only invalid rows: nothing removed
n=$(ev); printf -- '- X | zzz | 99:99 | 1\n' > "$t/cal.md"; run || fail "only invalid"
[ "$(ev)" = "$n" ] || fail "only invalid rows must not remove events"

# more than 14 rows
for i in $(seq 1 16); do echo "- Area$i | lun | 10:00 | 30"; done > "$t/cal.md"; run || fail "many rows"
jq -e '.skipped|length>=2' "$t/es/studio-calendar.json" >/dev/null || fail "rows over 14 not reported"

# static
grep -q 'studio-calendar-sync' "$D/cron.d-home-server" || fail "cron entry"
grep -q 'studio-calendar-sync' "$D/../deploy" || fail "deploy copy"
grep -q 'studio-calendar.json' "$D/mail-digest" || fail "mail-digest line"
echo "ok: studio-calendar-sync"
