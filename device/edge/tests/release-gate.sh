#!/bin/sh
# Test of release-gate (issue 208) with stubbed projects-publish/hs-setting/gateway-projects and a real git repo:
# each blocking rule, announcement, no merge before the notice, merge after it, head changed while waiting,
# major -> serve-owner, postponement, a Project without `auto` ignored, pause.
# From the repo root: device/edge/tests/release-gate.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin" "$t/app/sumi" "$t/proj" "$t/req"
G="git -C $t/proj/sumi"
git init -q "$t/proj/sumi"; $G config user.email a@b.c; $G config user.name a
echo 1 > "$t/proj/sumi/f"; $G add f; $G commit -qm one; C1=$($G rev-parse HEAD)
echo 2 > "$t/proj/sumi/f"; $G commit -qam two; C2=$($G rev-parse HEAD)
NOW=2000000000
printf '%s v0.4.0 go1\n' "$C2" > "$t/app/sumi/REF"; touch -d "@$((NOW - 5 * 86400))" "$t/app/sumi/REF"
echo '{"fail":{}}' > "$t/mon.json"; echo '{"projects":{"sumi":{"issues":[]}}}' > "$t/mirror.json"
printf '#!/bin/sh\necho "sumi - sumi active - - ${REL:-auto}"\necho "other - - active - - -"\n' > "$t/bin/gp"
printf '#!/bin/sh\ncase $1 in HS_RELEASE_PAUSE) echo ${PAUSE:-0};; HS_RELEASE_SOAK_DAYS) echo 3;; HS_RELEASE_MIN_DAYS) echo 7;; HS_RELEASE_NOTICE_HOURS) echo 24;; HS_RELEASE_HEAD_HOURS) echo 12;; esac\n' > "$t/bin/hss"
cat > "$t/bin/pub" <<'EOS'
#!/bin/sh
echo "$*" >> "$PUB_LOG"
case $1 in release-data) [ "$2" = sumi ] || exit 1; cat "$DATA" ;; release) echo "merged $3 (squash)" ;; esac
EOS
chmod +x "$t/bin/"*
BODY_FEAT='## [0.5.0](https://x) (2033-05-18)

### Features

* add thing'
BODY_FIX='## [0.4.1](https://x) (2033-05-18)

### Bug Fixes

* repair thing'
BODY_DOCS='## [0.4.1](https://x) (2033-05-18)

### Documentation

* words'
BODY_MAJOR='## [1.0.0](https://x) (2033-05-18)

### Features

* big'
mkdata() { # BODY CI LAST_AT_DAYS_AGO [HEAD] [PARENT]
	jq -n --arg b "$1" --arg ci "$2" --arg h "${4:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" --arg p "${5:-$C1}" \
		--arg la "$(date -u -d "@$((NOW - $3 * 86400))" +%Y-%m-%dT%H:%M:%SZ)" \
		'{pr: {number: 7, title: "chore: release main", body: $b, url: "https://github.com/me/sumi/pull/7", branch: "release-please--branches--main", head: $h, parent: $p, parent_at: ""}, ci: $ci, last: {tag: "v0.4.0", at: $la}}' > "$t/data.json"
}
fail=0
gate() { # NOWOFFSET_SECONDS
	: > "$t/pub.log"
	HS_NOW=$((NOW + ${1:-0})) HS_PUBLISH_CMD=$t/bin/pub HS_PROJECTS_CMD=$t/bin/gp HS_SETTING_CMD=$t/bin/hss HS_RELEASE_OUT=$t/out.json HS_RELEASE_CARD=$t/card.json HS_RELEASE_STATE=$t/state \
		HS_RELEASE_REQ_DIR=$t/req HS_APP_DIR=$t/app HS_CD_STATE=$t/cd HS_PROJECTS_DIR=$t/proj HS_ISSUES_MIRROR=$t/mirror.json HS_MONITOR_STATE=$t/mon.json PUB_LOG=$t/pub.log DATA=$t/data.json \
		sh "$R/device/edge/debian/release-gate" > /dev/null
}
st() { jq -r ".projects.sumi.status" "$t/out.json"; }
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
failing() { jq -r '[.projects.sumi.rules[] | select(.ok | not) | .rule] | join(",")' "$t/out.json"; }
fresh() { rm -rf "$t/state" "$t/req"/*; }

# blocking rules
fresh; mkdata "$BODY_DOCS" green 30; gate; check "changelog senza feat/fix: waiting" "$(st) $(failing)" "waiting changelog"
fresh; mkdata "$BODY_FEAT" red 30; gate; check "CI rossa" "$(st) $(failing)" "waiting ci"
fresh; mkdata "$BODY_FEAT" green 2; gate; check "meno di 7 giorni dall'ultima release" "$(st) $(failing)" "waiting interval"
fresh; mkdata "$BODY_FIX" green 2; gate; check "solo fix: l'intervallo non blocca" "$(st)" announced
fresh; mkdata "$BODY_FEAT" green 30 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$(printf 'b%.0s' $(seq 40))"; gate; check "commit base non nel commit installato" "$(st) $(failing)" "waiting soak"
touch -d "@$((NOW - 1 * 86400))" "$t/app/sumi/REF"; fresh; mkdata "$BODY_FEAT" green 30; gate; check "installato da meno di 3 giorni" "$(st) $(failing)" "waiting soak"
touch -d "@$((NOW - 5 * 86400))" "$t/app/sumi/REF"
# soak from project-cd's install log (issue 236): the run of installs that contain the PR's base commit
mkdir -p "$t/cd"; d() { date -u -d "@$((NOW - $1 * 86400))" '+%F %T'; }
# continuous health (issue 350): a new commit of main every 3 hours must not restart the count
h() { date -u -d "@$((NOW - $1 * 3600))" '+%F %T'; }
printf '%s %s v0.3\n%s %s v0.4\n' "$(d 5)" "$C1" "$(d 1)" "$C2" > "$t/cd/sumi.installs"
fresh; mkdata "$BODY_FEAT" green 30 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$C2"; gate; check "base nell'ultima installazione, ma 5 giorni di prova continua" "$(st)" announced
printf '%s %s v0.3\n%s %s v0.4\n%s %s v0.4\n' "$(d 5)" "$C1" "$(h 6)" "$C1" "$(h 3)" "$C2" > "$t/cd/sumi.installs"
fresh; mkdata "$BODY_FEAT" green 30 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$C2"; gate; check "ultimo commit di 3 ore: la regola head blocca" "$(st) $(failing)" "waiting head"
printf '%s %s v0.3\n%s %s v0.4\n' "$(d 5)" "$C1" "$(h 13)" "$C2" > "$t/cd/sumi.installs"
fresh; mkdata "$BODY_FEAT" green 30 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$C2"; gate; check "ultimo commit di 13 ore: esce" "$(st)" announced
printf '%s %s v0.3\n%s %s v0.4\n' "$(d 5)" "$C1" "$(h 13)" "$C2" > "$t/cd/sumi.installs"
printf '%s %s %s\n' "$(d 1)" "$C2" "$C1" > "$t/cd/sumi.rollbacks"
fresh; mkdata "$BODY_FEAT" green 30 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$C2"; gate; check "un rollback di 1 giorno fa azzera la prova" "$(st) $(failing)" "waiting soak"
printf '%s %s %s\n' "$(d 4)" "$C2" "$C1" > "$t/cd/sumi.rollbacks"
fresh; mkdata "$BODY_FEAT" green 30 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$C2"; gate; check "un rollback di 4 giorni fa non conta" "$(st)" announced
rm -f "$t/cd/sumi.rollbacks"
printf '%s %s v0.3\n' "$(d 5)" "$C1" > "$t/cd/sumi.installs"
fresh; mkdata "$BODY_FEAT" green 30 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$C2"; gate; check "log che non finisce col commit installato: vale l'mtime di REF" "$(st)" announced
rm -rf "$t/cd"
echo '{"fail":{"svc-sumisura":1}}' > "$t/mon.json"; fresh; mkdata "$BODY_FEAT" green 30; gate; check "monitor non verde" "$(st) $(failing)" "waiting monitor"
echo '{"fail":{}}' > "$t/mon.json"
jq -n --arg d "$(date -u -d "@$((NOW - 86400))" +%Y-%m-%dT%H:%M:%SZ)" '{projects:{sumi:{issues:[{state:"open",labels:["bug"],created:$d}]}}}' > "$t/mirror.json"
fresh; mkdata "$BODY_FEAT" green 30; gate; check "issue bug aperta dopo l'installazione" "$(st) $(failing)" "waiting bugs"
jq -n --arg d "$(date -u -d "@$((NOW - 9 * 86400))" +%Y-%m-%dT%H:%M:%SZ)" '{projects:{sumi:{issues:[{state:"open",labels:["bug"],created:$d}]}}}' > "$t/mirror.json"
fresh; mkdata "$BODY_FEAT" green 30; gate; check "issue bug vecchia: non conta" "$(st)" announced
echo '{"projects":{"sumi":{"issues":[]}}}' > "$t/mirror.json"
fresh; mkdata "$BODY_MAJOR" green 30; gate; check "major: serve-owner" "$(st)" serve-owner
check "major: nessuna unione" "$(grep -c '^release ' "$t/pub.log")" 0

# announce -> wait -> merge
fresh; mkdata "$BODY_FEAT" green 30; gate
check "annuncio" "$(st) $(jq -r '.projects.sumi.version' "$t/out.json")" "announced 0.5.0"
check "uscita tra 24 h" "$(jq -r '.projects.sumi.release_at - .projects.sumi.announced_at' "$t/out.json")" 86400
gate 3600; check "dopo 1 h: ancora annunciata, nessuna unione" "$(st) $(grep -c '^release ' "$t/pub.log")" "announced 0"
check "scheda per la dashboard" "$(jq -r .annuncio "$t/card.json")" "sumi v0.5.0 tra 23 h"
gate 90000; check "dopo 25 h: unita" "$(st) $(grep -c '^release sumi 7 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' "$t/pub.log")" "released 1"
echo '{"pr":null,"last":null}' > "$t/data.json"; gate 90100; check "PR sparita dopo l'unione: released" "$(st)" released

# head changed while waiting
fresh; mkdata "$BODY_FEAT" green 30; gate
mkdata "$BODY_FEAT" green 30 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; gate 90000
check "head cambiato: waiting, nessuna unione" "$(st) $(grep -c '^release ' "$t/pub.log")" "waiting 0"
# a rule failing at the end of the wait
fresh; mkdata "$BODY_FEAT" green 30; gate; mkdata "$BODY_FEAT" red 30; gate 90000
check "regola non più valida: nessuna unione" "$(st) $(grep -c '^release ' "$t/pub.log")" "waiting 0"

# postponement
fresh; mkdata "$BODY_FEAT" green 30; gate
printf '{"project":"sumi","at":%s}' "$((NOW + 100))" > "$t/req/sumi.req.json"
gate 200; check "rimanda" "$(st)" postponed
gate 90000; check "rimandata: nessuna unione dopo 25 h" "$(st) $(grep -c '^release ' "$t/pub.log")" "postponed 0"
mkdata "$BODY_FEAT
* more" green 30; gate 90100; check "nuovo changelog: la proroga finisce" "$(st)" announced

# project without auto, pause
fresh; REL=- mkdata "$BODY_FEAT" green 30; REL=- gate; check "Project senza auto ignorato" "$(jq -r '.projects | length' "$t/out.json") $(grep -c . "$t/pub.log")" "0 0"
fresh; mkdata "$BODY_FEAT" green 30; PAUSE=1 gate; check "pausa: non annuncia" "$(jq -r '.paused' "$t/out.json") $(st)" "true null"
exit $fail
