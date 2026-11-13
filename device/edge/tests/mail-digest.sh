#!/bin/sh
# Test of mail-digest (issue 412) with fake data, settings and mail-send: template sections, once a day from the set hour,
# weekend switch, off while the mail bridge is not linked, urgent battery mail (at most every 6 hours). Offline.
# From the repo root: device/edge/tests/mail-digest.sh
set -eu
R=$(cd "$(dirname "$0")/../../.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/es" "$T/up" "$T/repo/issues/done" "$T/repo/issues/open" "$T/repo/issues/proposed" "$T/setup" "$T/state"
fail() { echo "FAIL: $1" >&2; exit 1; }
# 2026-11-04 (Wednesday) 08:00 UTC and 2026-11-07 (Saturday).
WED=$(date -u -d '2026-11-04 08:00' +%s); SAT=$(date -u -d '2026-11-07 08:00' +%s)
echo '{"apps":[{"app":"ntfy","cur":"1.0","new":"1.1"}]}' > "$T/up/pending.json"
echo '{"advisories":[{"id":"GHSA-x","pkg":"caddy","severity":"HIGH","fixed":"2.7"},{"id":"CVE-low","pkg":"foo","severity":"LOW","fixed":""}]}' > "$T/up/advisories.json"
cat > "$T/es/updates-waiting.json" <<'EOF2'
{"apps":[{"app":"vaultwarden","cur":"1.37.4","new":"1.37.5","kind":"wait","auto":true,"eligible":"2026-11-09","days":7},{"app":"ntfy","cur":"2.37.1","new":"2.37.2","kind":"wait","auto":false,"eligible":"2026-11-11","days":7}]}
EOF2
echo '{"pending":"2 (sistema 1, second brain 1)","backlog":"3"}' > "$T/es/proposals.json"
echo '{"level": 80, "status": "In carica"}' > "$T/es/status.json"
echo '{"categories":{"s":{"jobs":[{"title":"Job rotto","status":"error"},{"title":"Job ok","status":"ok"}]}}}' > "$T/es/jobs.json"
printf '# Fatto ieri\n\nClosed: 2026-11-03\n' > "$T/repo/issues/done/100-a.md"
printf '# Vecchio\n\nClosed: 2026-10-01\n' > "$T/repo/issues/done/101-b.md"
printf '# Serve l owner\n\nBlocked on: user (x)\n' > "$T/repo/issues/open/200-c.md"
printf '# Libero\n\nBlocked on: -\n' > "$T/repo/issues/open/201-d.md"
printf '# SEGRETO\n' > "$T/repo/issues/proposed/300-e.md"
cat > "$T/send" <<'EOF2'
#!/bin/sh
h=; if [ "$1" = --html ]; then h=$(cat "$2"); shift 2; fi
b=$2; [ "$b" = - ] && b=$(cat)
printf 'SUBJECT: %s\n%s\n---\n' "$1" "$b" >> "$FAKE_DIR/mails"
[ -z "$h" ] || printf '%s\n' "$h" > "$FAKE_DIR/last.html"
EOF2
cat > "$T/set" <<'EOF2'
#!/bin/sh
case $1 in
HS_DIGEST_ENABLED) cat "$FAKE_DIR/enabled" ;;
HS_DIGEST_WEEKEND) cat "$FAKE_DIR/weekend" ;;
HS_DIGEST_HOUR) echo 7 ;;
esac
EOF2
printf '#!/bin/sh\necho "$2" >> "$FAKE_DIR/notes"\n' > "$T/notify"
chmod +x "$T/send" "$T/set" "$T/notify"; echo 1 > "$T/enabled"; echo 0 > "$T/weekend"; : > "$T/mails"
run() {
	env -u HS_TS_HOST HS_ENV_FILE=/dev/null HS_DIGEST_STATE="$T/state" HS_EDGE_STATUS="$T/es" HS_UPDATES_DIR="$T/up" HS_REPO="$T/repo" \
		HS_BRAIN_DIGEST="$T/bd" HS_MAIL_SEND="$T/send" HS_DIGEST_CERT=/nonexistent HS_MAIL_SETUP="$T/setup" HS_SETTING="$T/set" HS_NOTIFY="$T/notify" FAKE_DIR="$T" \
		HS_APPS_IDLE_STATE="$T/ai" HS_TRIAGE_STATE="$T/tri" HS_DIGEST_NOW="$1" TZ=UTC sh "$R/device/edge/debian/mail-digest" ${2:-}
}
count() { grep -c '^SUBJECT:' "$T/mails" || true; }

mkdir -p "$T/ai"; printf "2026-11-03 spenta sumisura\n2026-11-04 riaccesa library\n2026-10-20 spenta studio-app\n" > "$T/ai/events.log"
body=$(run "$WED" --print)
for s in "SICUREZZA" "GHSA-x caddy" "gravità high, corretto in 2.7" "Job rotto" "#100 Fatto ieri" "#200 Serve l owner" "In attesa: 2" "Backlog da rivedere: 3" "sumisura: spenta perché non usata" "library: riaccesa"; do
	echo "$body" | grep -qF "$s" || fail "missing in body: $s"
done
for s in "vaultwarden 1.37.4 → 1.37.5" "si installa da sé dal 09/11 (attesa di 7 giorni" "dal 11/11 si apre una issue" "https://github.com/dani-garcia/vaultwarden/releases/tag/1.37.5" "https://github.com/advisories/GHSA-x" "https://edge:8444/#100" "(https://edge:8444/#200)"; do
	echo "$body" | grep -qF "$s" || fail "missing in text: $s"
done
echo "$body" | grep -qF "studio-app" && fail "old app event in mail"
mv "$T/es/updates-waiting.json" "$T/w.json"; run "$WED" --print | grep -qF "ntfy 1.0 → 1.1" || fail "fallback to pending.json"; mv "$T/w.json" "$T/es/updates-waiting.json"
html=$(run "$WED" --print-html)
for s in "<a href=\"https://github.com/advisories/GHSA-x\"" "href=\"https://edge:8444/#100\"" "width=device-width" "Serve l owner"; do
	echo "$html" | grep -qF "$s" || fail "missing in html: $s"
done
# Rendering at 390 px (phone): screenshot kept in /tmp/mail-digest-ui/ to look at; skipped without chromium.
if command -v chromium > /dev/null 2>&1; then
	mkdir -p /tmp/mail-digest-ui; echo "$html" > "$T/d.html"
	timeout 60 chromium --headless --no-sandbox --disable-gpu --window-size=390,1400 --screenshot=/tmp/mail-digest-ui/digest-390.png "file://$T/d.html" > /dev/null 2>&1 || true
	[ -s /tmp/mail-digest-ui/digest-390.png ] || fail "chromium rendering"
fi
echo "$html" | grep -q "<script\|<img\|<style" && fail "html has script/img/style"
printf '# A <b>&\n\nClosed: 2026-11-04\n' > "$T/repo/issues/done/103-g.md"
run "$WED" --print-html | grep -qF "A &lt;b&gt;&amp;" || fail "html not escaped"
rm "$T/repo/issues/done/103-g.md"
echo "$body" | grep -qF "80%, in carica" || fail "battery line"
printf "# Fatto oggi\n\nClosed: 2026-11-04\n" > "$T/repo/issues/done/102-f.md"
b2=$(run "$WED" --print)
echo "$b2" | awk "/^Ieri:/{y=1} /^Oggi:/{y=2} /#100 /{if(y!=1)exit 1} /#102 /{if(y!=2)exit 1;f=1} END{exit !f}" || fail "ieri/oggi not separated"
echo "$b2" | grep -qF "80% (" && fail "old battery format"
rm "$T/repo/issues/done/102-f.md"
echo "$body" | grep -q 'CVE-low\|Vecchio\|Libero\|SEGRETO\|Job ok' && fail "body has what it should not"

# Studio, last week (issue 501): Mondays only, while the study app is on, fresh and valid numbers only.
MON=$(date -u -d '2026-11-09 08:00' +%s); mkdir -p "$T/svc"; export HS_SERVICE_DIR="$T/svc"
SW='{"t":'$MON',"week":"2026-11-02","minutes":495,"goal":420,"sessions":6,"parts":1,"gaps":2,"pending":40,"areas":[{"area":"algoritmi","minutes":300},{"area":"sql","minutes":195}]}'
echo "$SW" > "$T/es/studio-week.json"
run "$MON" --print | grep -q "SETTIMANA SCORSA" && fail "studio week section with the study app off"
: > "$T/svc/studio-app"
sw=$(run "$MON" --print)
for s in "STUDIO, SETTIMANA SCORSA" "Ore di studio: 8 h 15 min su 7 h di obiettivo" "Sessioni: 6" "Parti chiuse: 1" "Lacune ancora aperte: 2" "Studio da solo da verificare: 40 min" "Per area: algoritmi 300 min, sql 195 min"; do
	echo "$sw" | grep -qF "$s" || fail "missing in studio week: $s"
done
run "$WED" --print | grep -q "SETTIMANA SCORSA" && fail "studio week section on a Wednesday"
run "$((MON + 90000))" --print | grep -q "SETTIMANA SCORSA" && fail "stale studio week numbers shown"
echo "$SW" | sed 's/"minutes":495/"minutes":"<b>x<\/b>"/' > "$T/es/studio-week.json"
run "$MON" --print | grep -q "SETTIMANA SCORSA" && fail "studio week with out-of-format numbers shown"
echo "$SW" | sed 's/"area":"sql"/"area":"x y<script>"/' > "$T/es/studio-week.json"
run "$MON" --print | grep -q "script" && fail "invalid area name shown"
rm -f "$T/es/studio-week.json"; run "$MON" --print | grep -q "SETTIMANA SCORSA" && fail "studio week section without numbers"
rm -f "$T/svc/studio-app"

# Bridge off: nothing.
run "$WED"; [ "$(count)" = 0 ] || fail "sent while the bridge is off"
echo '{"url":"x"}' > "$T/setup/url.json"
run $((WED - 3600 * 2)); [ "$(count)" = 0 ] || fail "sent before the hour (06:00)"
run "$WED"; [ "$(count)" = 1 ] || fail "digest not sent"
grep -qF "Fatto ieri" "$T/last.html" || fail "digest sent without the HTML"
run $((WED + 600)); [ "$(count)" = 1 ] || fail "digest sent twice in a day"
run $((WED + 86400)); [ "$(count)" = 2 ] || fail "no digest the next day"
run "$SAT"; [ "$(count)" = 3 ] || fail "weekend skip must send the one-line notice (issue 518)"
grep -q "Riepilogo sospeso" "$T/mails" || fail "notice text"
run $((SAT + 600)); [ "$(count)" = 3 ] || fail "notice sent twice in a day"
echo 1 > "$T/weekend"; run $((SAT + 1200)); [ "$(count)" = 4 ] || fail "no digest on Saturday with weekend on"
grep -q "SOSPESO NEL WEEKEND" "$T/mails" || fail "first digest after the skip must carry the weekend line"
[ ! -e "$T/state/weekend-skipped" ] || fail "weekend flag not cleared by the digest"
echo 0 > "$T/enabled"; run $((SAT + 86400)); [ "$(count)" = 4 ] || fail "digest while disabled"

# Urgent battery: charging = nothing, discharging = one mail, then silence for 6 hours (even with the digest off).
echo '{"level": 10, "status": "In carica"}' > "$T/es/status.json"; run "$WED"; [ "$(count)" = 4 ] || fail "urgent while charging"
echo '{"level": 10, "status": "Non in carica"}' > "$T/es/status.json"
run "$WED" --print | grep -qF "10%, non in carica" || fail "battery with spaces in the status"
run "$WED"; [ "$(count)" = 5 ] || fail "no urgent mail"
run $((WED + 3600)); [ "$(count)" = 5 ] || fail "urgent repeated within 6 hours"
run $((WED + 7 * 3600)); [ "$(count)" = 6 ] || fail "no urgent mail after 6 hours"
# Brain's part (issue 414): appended after the server sections, validated, waiting for the part.
mkdir -p "$T/bd"; echo 1 > "$T/enabled"; echo 1 > "$T/weekend"
echo '{"level": 80, "status": "In carica"}' > "$T/es/status.json"; rm -f "$T/state/last-digest"
cat > "$T/bd/part.json" <<'EOF2'
{"day":"2026-11-04","sections":[{"key":"agenda","items":[{"text":"15:30 Dentista"},{"text":"vedi https://evil.example/x subito"}]},{"key":"attivita","items":[]},{"key":"inbox","items":[{"text":"a\u0007b.md"}]},{"key":"sicurezza","items":[{"text":"NON DEVE USCIRE"}]},{"key":"riassunto","items":[{"text":"Giornata tranquilla."}]}]}
EOF2
b3=$(run "$WED" --print)
for s in "AGENDA DI OGGI" "15:30 Dentista" "ATTIVITÀ" "Nessuna attività in scadenza." "INBOX IN ATTESA" "a b.md" "RIASSUNTO DEL SECOND BRAIN" "Giornata tranquilla."; do echo "$b3" | grep -qF "$s" || fail "brain part missing: $s"; done
echo "$b3" | grep -q "evil.example\|NON DEVE USCIRE" && fail "brain part not validated"
echo "$b3" | awk '/^SICUREZZA/{s=1} /^AGENDA/{if(!s)exit 1; f=1} END{exit !f}' || fail "brain part not after the server sections"
printf '{"day":"2026-11-03","sections":[{"key":"agenda","items":[{"text":"VECCHIO"}]}]}' > "$T/bd/part.json"
run "$WED" --print | grep -q "VECCHIO\|AGENDA DI OGGI" && fail "part of another day shown"
# One source (issue 473): the vault note's hour, weekend and sections are not read; only the settings page counts.
printf '{"updated":%s,"hour":9,"minute":15,"weekend":false,"sections":["agenda"]}' "$WED" > "$T/bd/settings.json"
printf '{"day":"2026-11-04","sections":[{"key":"agenda","items":[{"text":"15:30 Dentista"}]}]}' > "$T/bd/part.json"
b4=$(run "$WED" --print)
for s in SICUREZZA "COSA È STATO FATTO" "ASPETTANO TE" "PROPOSTE DA DECIDERE" BATTERIA "AGENDA DI OGGI"; do echo "$b4" | grep -qF "$s" || fail "section missing (note must not limit): $s"; done
echo "$b4" | grep -q "NOTA DEL VAULT" && fail "footer about the vault note"
echo 1 > "$T/weekend"; rm -f "$T/state/last-digest" "$T/notes" "$T/es/digest.json"
n0=$(count); run "$SAT"; [ "$(count)" = $((n0 + 1)) ] || fail "Saturday mail must follow the settings page, not the note's «weekend: false»"
[ ! -e "$T/notes" ] || fail "notice about the note"; [ ! -e "$T/es/digest.json" ] || fail "digest.json still written"
rm -f "$T/state/last-digest" "$T/bd/settings.json"
# The mail waits up to an hour for the part while brain-digest is alive (alive.json), then goes without it.
printf '{"updated":%s}' "$WED" > "$T/bd/alive.json"; rm -f "$T/bd/part.json"
n1=$(count); run $((WED - 1800)); [ "$(count)" = "$n1" ] || fail "did not wait for the brain part (07:30, send time 07:00)"
run "$WED"; [ "$(count)" = $((n1 + 1)) ] || fail "kept waiting past an hour"
# alive.json stale (brain-digest stopped): no waiting.
printf '{"updated":%s}' $((WED - 3 * 86400)) > "$T/bd/alive.json"; rm -f "$T/state/last-digest"
n2=$(count); run $((WED - 1800)); [ "$(count)" = $((n2 + 1)) ] || fail "stale alive.json made the mail wait"
# Weekly friction line (issue 468): Mondays only.
echo '{"mail":"Attriti: 2 domande senza risposta."}' > "$T/es/attriti.json"
MON=$(date -u -d '2026-11-09 08:00' +%s)
run "$MON" --print | grep -qF "Attriti: 2 domande senza risposta." || fail "no friction line on Monday"
run "$WED" --print | grep -qF "Attriti:" && fail "friction line outside Monday"
rm "$T/es/attriti.json"; run "$MON" --print | grep -qF "Attriti:" && fail "friction line without data"
# Issues moved to backlog (issue 478): yesterday and today only.
mkdir -p "$T/tri"; printf "2026-11-04 123 Roba inutile|Non serve alla direzione.\n2026-10-01 124 Vecchia|Antica.\n" > "$T/tri/moved.log"
run "$WED" --print | grep -qF "#123 Roba inutile" || fail "moved issue not in the mail"
run "$WED" --print | grep -qF "Vecchia" && fail "old moved issue in the mail"
echo "ok"