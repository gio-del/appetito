#!/bin/sh
# Test of the scheduled-jobs view (issue 224): render-schedule needs a valid category, hs-run leaves
# the last result, jobs-status sorts jobs into ok / error / late / nodata and distrusts foreign files.
# From the repo root: device/edge/tests/jobs-status.sh
set -eu
HERE=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL $1"; exit 1; }

# render-schedule: category required and valid, catalog and cards
printf '%s\n' '#@ Senza categoria | Ogni minuto | x' '* * * * * hs-run a true' > "$T/nocat"
"$HERE/render-schedule" "$T/nocat" > /dev/null 2>&1 && fail "riga senza categoria accettata"
printf '%s\n' '#@ [Inventata] Titolo | Ogni minuto | x' '* * * * * hs-run a true' > "$T/badcat"
"$HERE/render-schedule" "$T/badcat" > /dev/null 2>&1 && fail "categoria sconosciuta accettata"
printf '%s\n' '#@ [Backup] Senza riga' > "$T/ok0"; printf '%s\n' '* * * * * hs-run b true' >> "$T/ok0"
printf '%s\n' '* * * * * hs-run c true' >> "$T/ok0"
"$HERE/render-schedule" "$T/ok0" > /dev/null 2>&1 && fail "job senza #@ accettato"
cat > "$T/cron" <<'CRON'
#@ [Backup] Uno | Ogni minuto | x
* * * * * hs-run job-one true
#@ [Backup] Due | Ogni notte alle 3:37 | x
37 3 * * * root hs-run job-two true
#@ [Sistema] Tre | Ogni 5 minuti | x
*/5 * * * * hs-run job-three true
#@ [Sistema] Quattro | Ogni ora | x | live.json when
17 * * * * hs-run job-four true
CRON
printf '%s\n' '#@ [Second brain] Cinque | Ogni 15 minuti | x' '*/15 * * * * hs-run job-brain true' > "$T/crontab-brain"
"$HERE/render-schedule" "$T/cron" "$T/crontab-brain" > /dev/null || fail "render-schedule"
"$HERE/render-schedule" --json "$T/cron" "$T/crontab-brain" > "$T/hs-jobs.json" || fail "catalogo"
"$HERE/render-schedule" --schedule "$T/cron" "$T/crontab-brain" > "$T/schedule.json" || fail "schedule.json"
[ "$(jq -r ".categories[] | select(.key==\"second_brain\") | .count" "$T/schedule.json")" = 1 ] || fail "conteggio schedule.json"
[ "$(jq -r '[.[] | select(.name=="job-two") | .every][0]' "$T/hs-jobs.json")" = 86400 ] || fail "intervallo notturno"
[ "$(jq -r '[.[] | select(.name=="job-three") | .every][0]' "$T/hs-jobs.json")" = 300 ] || fail "intervallo 5 minuti"
[ "$(jq -r '[.[] | select(.name=="job-brain") | .user][0]' "$T/hs-jobs.json")" = brain ] || fail "utente brain"

# hs-run leaves {t, rc, dur} and never the output
mkdir "$T/jobs" "$T/events"
cp "$HERE/debian/hs-run" "$T/hs-run"; sed -i "s|/var/lib/hs-jobs|$T/jobs|g; s|/var/lib/hs-events|$T/events|g" "$T/hs-run"; chmod +x "$T/hs-run"
"$T/hs-run" job-one sh -c 'echo segreto' > /dev/null || fail "hs-run di un job ok"
[ "$(jq -r '.rc' "$T/jobs/job-one.json")" = 0 ] || fail "rc 0 non scritto"
grep -q segreto "$T/jobs/job-one.json" && fail "output nel file"
"$T/hs-run" job-three sh -c 'exit 3' > /dev/null || true
ls "$T"/events/job-three.* > /dev/null 2>&1 || fail "evento non nella dir del test"
[ "$(jq -r '.rc' "$T/jobs/job-three.json")" = 3 ] || fail "rc 3 non scritto"
[ "$(jq -r '.t | type' "$T/jobs/job-one.json")" = number ] || fail "ora"

# jobs-status: job-one ok, job-two late (written 3 days ago), job-three error, job-four nodata,
# job-brain: file owned by someone else than brain -> ignored
NOW=$(date +%s)
printf '{"t":%s,"rc":0,"dur":1}\n' $((NOW - 3 * 86400)) > "$T/jobs/job-two.json"
printf '{"t":%s,"rc":0,"dur":1}\n' "$NOW" > "$T/jobs/job-brain.json"
echo '{"when":"Ogni giorno alle 9:00"}' > "$T/live.json"
HS_JOBS_CATALOG="$T/hs-jobs.json" HS_JOBS_DIR="$T/jobs" HS_JOBS_OUT="$T/jobs-out.json" HS_JOBS_LIVE_DIR="$T" HS_JOBS_NOW="$NOW" HS_JOBS_BRAIN_UID=4242 \
	node "$HERE/debian/jobs-status" || fail "jobs-status"
q() { jq -r "$1" "$T/jobs-out.json"; }
[ "$(q '.categories.backup.label')" = "⚠ 1 in ritardo" ] || fail "label backup: $(q '.categories.backup.label')"
[ "$(q '.categories.sistema.label')" = "⚠ 1 con errore" ] || fail "label sistema: $(q '.categories.sistema.label')"
[ "$(q '.categories.sistema.nodata')" = 1 ] || fail "nodata"
[ "$(q '.categories.second_brain.label')" = "in attesa del primo giro" ] || fail "file di un altro utente accettato per brain"
[ "$(q '.categories.sistema.jobs[1].when')" = "Ogni giorno alle 9:00" ] || fail "riga Quando live"
[ "$(q '.categories.backup.problem')" = true ] || fail "problem"
# an hour later nothing has run: job-one is late too, with the interval doubled
HS_JOBS_CATALOG="$T/hs-jobs.json" HS_JOBS_DIR="$T/jobs" HS_JOBS_OUT="$T/jobs-out.json" HS_JOBS_LIVE_DIR="$T" HS_JOBS_NOW=$((NOW + 3600)) HS_JOBS_BRAIN_UID=4242 node "$HERE/debian/jobs-status"
[ "$(q '.categories.backup.jobs[0].status')" = late ] || fail "job-one non in ritardo dopo un'ora"
echo "ok jobs-status: categoria obbligatoria, hs-run, ok/errore/ritardo/nessun dato, file non fidati"
