#!/bin/sh
# Test of the merged scheduled jobs (issue 479): backup-all, sessions-refresh, log-trim-system.
# A failing piece does not stop the others and is named; the cron lines run through hs-run.
# From the repo root: device/edge/tests/accorpate.sh
set -eu
D=$PWD/device/edge/debian
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL $1"; exit 1; }
for n in ok1 bad ok2; do
	printf '#!/bin/sh\necho %s >> "%s/ran"\n%s\n' "$n" "$T" "$([ $n = bad ] && echo 'exit 3' || echo 'exit 0')" > "$T/$n"; chmod +x "$T/$n"
done
rc=0; HS_BACKUP_ALL_DIR=$T HS_BACKUP_ALL_LIST="ok1 bad ok2" sh "$D/backup-all" 2> "$T/err" || rc=$?
[ "$rc" = 1 ] || fail "backup-all deve fallire se un pezzo fallisce"
[ "$(cat "$T/ran")" = "ok1
bad
ok2" ] || fail "backup-all deve eseguire tutti i pezzi"
grep -q "backup fallito: bad" "$T/err" || fail "backup-all deve nominare il pezzo"
grep -q "backup fallito: ok" "$T/err" && fail "backup-all nomina un pezzo riuscito"
HS_BACKUP_ALL_DIR=$T HS_BACKUP_ALL_LIST="ok1 ok2" sh "$D/backup-all" || fail "backup-all tutto ok"
for b in vaultwarden-backup radicale-backup library-backup sumisura-backup state-backup repo-backup studio-backup; do
	grep -q "$b" "$D/backup-all" || fail "backup-all non conosce $b"
done
# sessions-refresh: brain fails, studio still runs
printf '#!/bin/sh\necho "$*" >> "%s/sess"\n[ -n "$*" ]\n' "$T" > "$T/br"; chmod +x "$T/br"
rc=0; HS_SESSIONS_LOGDIR=$T HS_SESSIONS_REFRESH=$T/br sh "$D/sessions-refresh" > "$T/err" 2>&1 || rc=$?
[ "$rc" = 1 ] && grep -q "sessione fallita: brain" "$T/err" || fail "sessions-refresh deve nominare brain"
grep -q '^studio' "$T/sess" || fail "sessions-refresh deve girare anche studio"
# log-trim-system: one call with all the root logs; its failure is the job's
printf '#!/bin/sh\necho "$*" > "%s/lt.out"\n' "$T" > "$T/lt"; chmod +x "$T/lt"
HS_LOG_TRIM=$T/lt sh "$D/log-trim-system" || fail "log-trim-system"
for f in tailscaled.log claude-update-all.log brain-refresh.log studio-refresh.log app-sumisura.log app-library.log app-studio-app.log; do
	grep -q "$f" "$T/lt.out" || fail "log-trim-system non pota $f"
done
# the cron lines
for j in backup-all sessions-refresh log-trim-system; do grep -q "hs-run $j /usr/local/sbin/$j" "$D/cron.d-home-server" || fail "cron $j"; done
echo "ok: accorpate"
