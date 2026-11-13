#!/bin/sh
# Test of project-cd (issue 235) with stubbed gateway-projects/hs-setting/projects-publish/<app>-setup/probe and
# real git repos: green commit installed, red/pending ignored, failing probe -> rollback + exit 1 + no new
# attempt on that commit, pause respected, history of 3, status JSON.
# From the repo root: device/edge/tests/project-cd.sh
set -eu
S=$PWD/device/edge/debian/project-cd
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin" "$t/sbin" "$t/opt/app" "$t/sv" "$t/home/projects" "$t/st"
fail() { echo "FAIL: project-cd: $*"; cat "$t/out" 2>/dev/null; exit 1; }
echo "HS_USER=$(id -un)" > "$t/env"
git init -q "$t/home/projects/sumi"; G="git -C $t/home/projects/sumi"
$G config user.email a@b.c; $G config user.name a
# origin/main: a ref pointing at HEAD, moved by commit()
commit() { echo "$1" > "$t/home/projects/sumi/f"; $G add f; $G commit -qm "$1"; $G update-ref refs/remotes/origin/main HEAD; $G rev-parse HEAD; }
C1=$(commit 1)
printf '%s v1\n' "$C1" > "$t/opt/app/REF"; ln -s /tmp "$t/sv/app"
printf '#!/bin/sh\necho "sumi x app active"\necho "home-server - - active"\n' > "$t/bin/gp"
printf '#!/bin/sh\ncase $1 in HS_CD_PAUSE_SUMI) cat "$HS_T/pause" ;; *) exit 2 ;; esac\n' > "$t/bin/hss"
printf '#!/bin/sh\ncat "$HS_T/ci"\n' > "$t/bin/pub"
printf '#!/bin/sh\nexit 0\n' > "$t/bin/pg"
# the app-setup stub installs HS_CD_REF
cat > "$t/sbin/app-setup" <<'EOS'
#!/bin/sh
echo "$HS_CD_REF" >> "$HS_T/setups"
printf '%s v-%s\n' "$HS_CD_REF" "$(printf %s "$HS_CD_REF" | cut -c1-4)" > "$HS_T/opt/app/REF"
EOS
# the probe fails while the installed commit is the one listed in badref
printf '#!/bin/sh\n! grep -q "^$(cut -d" " -f1 "$HS_T/opt/app/REF")$" "$HS_T/badref"\n' > "$t/bin/probe"
printf '#!/bin/sh\necho "$*" >> "$HS_T/notify.log"\n' > "$t/bin/notify"
chmod 755 "$t"/bin/* "$t/sbin/app-setup"
: > "$t/badref"; echo 0 > "$t/pause"; echo green > "$t/ci"; : > "$t/setups"
run() { env HS_T=$t HS_ENV_FILE=$t/env HS_CD_STATE=$t/st HS_CD_OUT=$t/out.json HS_CD_OPT=$t/opt HS_CD_SBIN=$t/sbin HS_SERVICE_DIR=$t/sv \
	HS_GATEWAY_PROJECTS=$t/bin/gp HS_SETTING_CMD=$t/bin/hss HS_PROJECTS_PUBLISH=$t/bin/pub HS_PROJECTS_GIT=$t/bin/pg HS_CD_HOME=$t/home HS_CD_NOUSER=1 \
	HS_NOTIFY=$t/bin/notify HS_CD_PROBE=$t/bin/probe HS_CD_GRACE=0 HS_CD_CHECKS=2 HS_CD_EVERY=0 sh "$S" > "$t/out" 2>&1; }
# the stub setup writes into $HS_T/opt: make the path match
ln -s "$t/opt" "$t/optlink" 2>/dev/null || true
dbg() { cat "$t/out.json" "$t/out"; }
cur() { cut -d' ' -f1 "$t/opt/app/REF"; }

# 1. nothing new: nothing installed
run || fail "exit on idle"
[ ! -s "$t/setups" ] || fail "installed with nothing new"
[ "$(jq -r .sumi.ref "$t/out.json")" = "$C1" ] || { dbg; fail "status json"; }
# 2. new commit, CI pending/red: ignored
C2=$(commit 2)
for s in pending red errore; do echo $s > "$t/ci"; run || fail "exit with CI $s"; [ ! -s "$t/setups" ] || fail "installed with CI $s"; done
grep -q "CI" "$t/out" || fail "no CI note"
# 3. green: installed, history
echo green > "$t/ci"; run || fail "exit on green"
[ "$(cur)" = "$C2" ] || fail "green not installed"
[ "$(wc -l < "$t/st/sumi.history")" = 1 ] || fail "history"
# 4. pause: a new green commit is not installed
C3=$(commit 3); echo 1 > "$t/pause"; run || fail "exit paused"
[ "$(cur)" = "$C2" ] || fail "installed while paused"
[ "$(jq -r .sumi.paused "$t/out.json")" = true ] || fail "paused flag"
# 5. probe fails: rollback to C2, exit 1, commit remembered
echo 0 > "$t/pause"; echo "$C3" > "$t/badref"; : > "$t/setups"
if run; then fail "exit 0 after rollback"; fi
[ "$(cur)" = "$C2" ] || fail "no rollback ($(cur))"
grep -q "sumi: ${C3%"${C3#???????}"} non parte, tornato a ${C2%"${C2#???????}"}" "$t/out" || fail "message"
grep -q "^$C3$" "$t/st/sumi.failed" || fail "failed not recorded"
grep -q "^--urgent .*Installazione annullata sumi: " "$t/notify.log" || fail "no urgent push on rollback"
[ "$(wc -l < "$t/st/sumi.history")" = 1 ] || fail "history changed by failure"
# 6. no new attempt on the failed commit
: > "$t/setups"; run || fail "exit after failed"
[ ! -s "$t/setups" ] || fail "retried a failed commit"
[ "$(wc -l < "$t/notify.log")" = 1 ] || fail "pushes besides the rollback one"
# 7. a later green commit installs; history keeps the last 3
C4=$(commit 4); run || fail "exit C4"; [ "$(cur)" = "$C4" ] || fail "C4"
C5=$(commit 5); run || fail "C5"; C6=$(commit 6); run || fail "C6"
[ "$(wc -l < "$t/st/sumi.history")" = 3 ] || fail "history not trimmed to 3"
[ "$(jq -r '.sumi.history | length' "$t/out.json")" = 3 ] || fail "json history"
# 8. a service not enabled is ignored
rm "$t/sv/app"; C7=$(commit 7); run || fail "disabled"; [ "$(cur)" = "$C6" ] || fail "installed a disabled app"
# 9. a Project whose pause setting does not exist is not "paused by the owner": the card says why (issue 496)
ln -s /tmp "$t/sv/app"; printf '#!/bin/sh\nexit 2\n' > "$t/bin/hss"; C8=$(commit 8); run || fail "exit without the setting"
[ "$(cur)" = "$C6" ] || fail "installed without its pause setting"
[ "$(jq -r .sumi.note "$t/out.json")" = "non segue main: manca l'impostazione" ] || { dbg; fail "note for a missing setting"; }
jq -r .sumi.card "$t/out.json" | grep -q "manca l'impostazione" || fail "card for a missing setting"
echo "ok: project-cd"
