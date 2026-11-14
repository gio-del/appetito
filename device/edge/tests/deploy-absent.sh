#!/bin/sh
# Il deploy e i cron non chiamano script assenti (issue 584, epic 567): nella copia pubblica di Appetito mancano gli
# script di un Project specifico, la mail, il telefono e la dashboard. Prova filter_cron e cpo del deploy.
# Esegui dalla radice del repo: device/edge/tests/deploy-absent.sh
set -eu
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: deploy-absent: $1"; exit 1; }
# le due funzioni, estratte dal deploy cosi' come sono
sed -n '/^cpo() {/p;/^filter_cron() {/,/^}/p' device/edge/deploy > "$t/fn.sh"
[ "$(wc -l < "$t/fn.sh")" -gt 5 ] || fail "funzioni non trovate nel deploy"
D=$t/debian; mkdir -p "$D"; : > "$D/presente"
cat > "$t/cron" <<'C'
PATH=/usr/bin
#@ [Sistema] Presente | ogni minuto | c'e'
* * * * * hs-run presente bin/presente >> .local/state/p.log 2>&1
#@ [Sistema] Assente | ogni minuto | manca
* * * * * hs-run assente bin/assente >> .local/state/a.log 2>&1
#@ [Backup] Assente root | ogni notte | manca
37 3 * * * root hs-run assente2 /usr/local/sbin/assente2 --acl
#@ [Sistema] Con sh -c | ogni notte | resta
53 4 * * * hs-run trim sh -c 'cmd'
C
(. "$t/fn.sh"; filter_cron "$t/cron" "$t/out") 2> "$t/err"
grep -q 'hs-run presente' "$t/out" || fail "tolto un job presente"
grep -q 'Presente' "$t/out" || fail "tolta la riga #@ del job presente"
grep -q 'assente' "$t/out" && fail "job assente rimasto"
grep -q 'Assente' "$t/out" && fail "riga #@ del job assente rimasta"
grep -q 'hs-run trim sh -c' "$t/out" || fail "tolto un job senza script"
grep -q '^PATH=' "$t/out" || fail "tolta la riga di ambiente"
grep -q 'no assente' "$t/err" || fail "il job saltato non e' detto"
# cpo: copia quel che c'e', salta il resto, non fallisce
mkdir "$t/dst"
(. "$t/fn.sh"; cpo "$D/presente" "$D/assente" "$t/dst/") || fail "cpo fallisce"
[ -e "$t/dst/presente" ] && [ ! -e "$t/dst/assente" ] || fail "cpo non copia solo quel che c'e'"
# i cron veri, filtrati con i file di questa installazione: ogni job rimasto ha il suo script
for f in crontab-user crontab-brain cron.d-home-server; do
	(D=device/edge/debian; . "$t/fn.sh"; filter_cron "device/edge/debian/$f" "$t/real-$f") 2> /dev/null
	sed -n 's#.* hs-run [^ ]* \(bin/\|/usr/local/sbin/\|/usr/local/bin/\)\([A-Za-z0-9._-]*\).*#\2#p' "$t/real-$f" | while read -r s; do
		[ -e "device/edge/debian/$s" ] || echo "$s"; done
done > "$t/miss"
[ ! -s "$t/miss" ] || fail "job rimasti senza script: $(tr '\n' ' ' < "$t/miss")"
echo "ok: deploy-absent"
