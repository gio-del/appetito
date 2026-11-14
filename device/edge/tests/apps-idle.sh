#!/bin/sh
# Test of debian/apps-idle (issue 477): measure (curl probes don't count), turn off past the threshold, always-on,
# flag respected by the *-setup scripts, turn back on, base services untouched.
# Run from the repo root: device/edge/tests/apps-idle.sh
set -eu
D=$PWD/device/edge/debian
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin" "$t/st" "$t/log" "$t/svd" "$t/svs/sumisura" "$t/svs/library"
fail() { echo "FAIL: apps-idle: $*"; exit 1; }
echo "HS_USER=x" > "$t/env"
printf '#!/bin/sh\necho "sumisura - sumisura - active"\necho "library - library - active"\necho "home-server - - - active"\n' > "$t/bin/gp"
printf '#!/bin/sh\necho 30\n' > "$t/bin/set"
printf '#!/bin/sh\necho "$*" >> %s/sv.log\n' "$t" > "$t/bin/sv"
chmod +x "$t/bin/"*
echo $((2000000000 - 40 * 86400)) > "$t/st/sumisura.last"; echo 1999000000 > "$t/st/library.last"
ln -s "$t/svs/sumisura" "$t/svd/sumisura"; ln -s "$t/svs/library" "$t/svd/library"
NOW=2000000000
line() { printf '{"ts":%s,"request":{"headers":{"User-Agent":["%s"]}}}\n' "$1" "$2"; }
# sumisura: owner 40 days ago, probe now; library: owner 5 days ago
{ line $((NOW - 40 * 86400)) Mozilla/5.0; line "$NOW" curl/8.0; } > "$t/log/app-sumisura.log"
line $((NOW - 5 * 86400)) Mozilla/5.0 > "$t/log/app-library.log"
export PATH="$t/bin:$PATH" HS_ENV_FILE=$t/env HS_APPS_IDLE_STATE=$t/st HS_APPS_IDLE_LOGDIR=$t/log HS_SERVICE_DIR=$t/svd HS_SV_DIR=$t/svs \
	HS_GATEWAY_PROJECTS=$t/bin/gp HS_SETTING_CMD=$t/bin/set HS_APPS_IDLE_NOW=$NOW
A=$D/apps-idle
sh "$A" scan > "$t/out"
[ ! -e "$t/svd/sumisura" ] && [ -e "$t/st/sumisura.off" ] || fail "sumisura (idle 40 days) not turned off"
grep -q "^downwards\|sumisura" "$t/sv.log" || fail "no sv down"
[ -L "$t/svd/library" ] && [ ! -e "$t/st/library.off" ] || fail "library (5 days) was turned off"
[ "$(cat "$t/st/sumisura.last")" = $((NOW - 40 * 86400)) ] || fail "curl probe counted as use"
grep -q "spenta sumisura" "$t/st/events.log" || fail "no event"
# the setup scripts respect the flag
# (a setup script of a Project that is not in the public copy is skipped, issue 584)
for pair in sumisura:sumisura library:library studio-app:studio-app; do
	[ -e "$D/${pair%:*}-setup" ] || continue
	grep -q "apps-idle/${pair#*:}.off" "$D/${pair%:*}-setup" || fail "a setup script ignores the flag"
done
# always: library idle later but flagged
line $((NOW - 100 * 86400)) Mozilla/5.0 > "$t/log/app-library.log"; echo $((NOW - 100 * 86400)) > "$t/st/library.last"
sh "$A" always library >/dev/null; sh "$A" scan >/dev/null
[ -L "$t/svd/library" ] || fail "always-on app turned off"
sh "$A" state library | jq -e '.always == true' >/dev/null || fail "state always"
sh "$A" auto library >/dev/null; [ ! -e "$t/st/library.always" ] || fail "auto"
# turn back on: link back, use restarts from today, no second event on a second call
sh "$A" on sumisura >/dev/null
[ -L "$t/svd/sumisura" ] && [ ! -e "$t/st/sumisura.off" ] && [ "$(cat "$t/st/sumisura.last")" = "$NOW" ] || fail "on"
sh "$A" scan >/dev/null; [ -L "$t/svd/sumisura" ] || fail "turned off again right after on"
sh "$A" on nope >/dev/null 2>&1 && fail "unknown app accepted"
sh "$A" on vaultwarden >/dev/null 2>&1 && fail "base service accepted"
# requests from the tracker: validated, applied, deleted
export HS_APPS_IDLE_REQ=$t/req; mkdir -p "$t/req"
sh "$A" scan >/dev/null; [ -L "$t/svd/sumisura" ] || fail "setup"
echo always > "$t/req/library"; echo rm-rf > "$t/req/sumisura"; echo on > "$t/req/vaultwarden"
sh "$A" requests >/dev/null 2>&1
[ -e "$t/st/library.always" ] || fail "request always not applied"
[ -z "$(ls "$t/req")" ] || fail "requests not deleted"
# new app: first sight turns it off ("nuova"), Prova links it, unused trial goes off after HS_APP_TRIAL_HOURS, used one stays
printf '#!/bin/sh\necho "sumisura - sumisura - active"\necho "library - library - active"\necho "fresh - fresh - active"\n' > "$t/bin/gp"; mkdir -p "$t/svs/fresh"; ln -s "$t/svs/fresh" "$t/svd/fresh"
sh "$A" scan >/dev/null
[ ! -e "$t/svd/fresh" ] && [ -e "$t/st/fresh.new" ] && grep -q "nuova fresh" "$t/st/events.log" || fail "new app not started off"
sh "$A" state fresh | jq -e '.new == true' >/dev/null || fail "state new"
sh "$A" trial fresh >/dev/null
[ -L "$t/svd/fresh" ] && [ ! -e "$t/st/fresh.new" ] && [ -e "$t/st/fresh.trial" ] || fail "trial"
grep -q "prova fresh" "$t/st/events.log" || fail "trial event"
sh "$A" scan >/dev/null; [ -L "$t/svd/fresh" ] || fail "trial turned off too early"
HS_APPS_IDLE_NOW=$((NOW + 31 * 3600)) sh "$A" scan >/dev/null
[ ! -e "$t/svd/fresh" ] && [ ! -e "$t/st/fresh.trial" ] || fail "unused trial not turned off"
sh "$A" trial fresh >/dev/null; line $((NOW + 3600)) Mozilla/5.0 > "$t/log/app-fresh.log"
HS_APPS_IDLE_NOW=$((NOW + 31 * 3600)) sh "$A" scan >/dev/null
[ -L "$t/svd/fresh" ] && [ ! -e "$t/st/fresh.trial" ] || fail "used trial not kept"
# features (issue 480): proposte / domande, measured from issues and suggestion files, gated in hs-run
I=$t/iss; mkdir -p "$I/open" "$I/done" "$t/qs"
export HS_ISSUES_DIR=$I HS_QS_DIR=$t/qs
printf '# x\nSource: system\nOwner-confirmed: 2033-05-17\n' > "$I/open/001-p.md"
NOW=$(date -d 2033-06-06 +%s); export HS_APPS_IDLE_NOW=$NOW
sh "$A" scan > /dev/null; [ ! -e "$t/st/proposte.off" ] || fail "proposte (used 20 days ago) turned off"
sh "$A" state proposte | jq -e '.app == "proposte"' > /dev/null || fail "state of a feature"
printf '{"answer":"Sì, va bene: applicalo anche qui"}' > "$t/qs/abc.json"
printf '# y\n\n## Comments\n\n### 2033-06-01 10:00 (owner)\nSì, va bene: applicalo anche qui, grazie\n' > "$I/open/002-q.md"
sh "$A" scan > /dev/null; [ "$(cat "$t/st/domande.last")" = "$(date -d 2033-06-01 +%s)" ] || fail "accepted suggestion not measured"
printf "2033-06-02 10:00:00 run: 0 item(s), 0 answer(s)\n2033-06-03 10:00:00 run: 2 item(s), 0 answer(s), 0 name(s) to tidy: a|b\n" > "$t/sort.log"; printf "2033-06-04 09:00:00 done: x -> y\n" > "$t/tailor.log"
HS_BRAIN_SORT_LOG=$t/sort.log HS_TAILOR_LOG=$t/tailor.log sh "$A" scan > /dev/null
[ "$(cat "$t/st/smistamento.last")" = "$(date -d 2033-06-03 +%s)" ] && [ "$(cat "$t/st/cv.last")" = "$(date -d 2033-06-04 +%s)" ] || fail "smistamento/cv use not measured"
HS_APPS_IDLE_NOW=$(($(date -d 2033-06-04 +%s) + 31 * 86400)) sh "$A" scan > /dev/null
[ -e "$t/st/domande.off" ] && [ -e "$t/st/proposte.off" ] || fail "idle features not turned off"
grep -q "spenta domande" "$t/st/events.log" || fail "feature event"
[ -e "$t/st/smistamento.off" ] && [ -e "$t/st/cv.off" ] || fail "idle smistamento/cv not turned off"
sh "$A" gate brain-sort > /dev/null && fail "gate lets brain-sort run"
sh "$A" gate sumisura-tailor > /dev/null && fail "gate lets sumisura-tailor run"
sh "$A" gate questions-suggest > /dev/null && fail "gate lets a job of an off feature run"
sh "$A" gate ops-suggest > /dev/null && fail "gate lets ops-suggest run"
sh "$A" gate backup-all > /dev/null || fail "gate blocks a maintenance job"
HS_APPS_IDLE_GATE=$A sh "$D/hs-run" questions-suggest echo ran > "$t/o" 2>&1 || true
grep -q "skipped" "$t/o" && ! grep -q "^ran" "$t/o" || fail "hs-run ran an off feature"
HS_APPS_IDLE_GATE=$A sh "$D/hs-run" backup-all echo ran 2> /dev/null | grep -q ran || fail "hs-run skipped maintenance"
# turn back on = retry (counting restarts, idle again after the threshold); always = never off; no trial
sh "$A" on domande > /dev/null; [ ! -e "$t/st/domande.off" ] || fail "feature on"
sh "$A" scan > /dev/null; [ ! -e "$t/st/domande.off" ] || fail "turned off right after on"
HS_APPS_IDLE_NOW=$((NOW + 31 * 86400)) sh "$A" scan > /dev/null; [ -e "$t/st/domande.off" ] || fail "retried feature not turned off again"
sh "$A" on domande > /dev/null; sh "$A" always domande > /dev/null
HS_APPS_IDLE_NOW=$((NOW + 90 * 86400)) sh "$A" scan > /dev/null; [ ! -e "$t/st/domande.off" ] || fail "always-on feature turned off"
sh "$A" trial domande > /dev/null 2>&1 && fail "trial accepted for a feature"
echo "ok: apps-idle"
