#!/bin/sh
# Test of debian/studio-app-setup (issue 461) with stubs for the root-only commands:
# - not listed with the service studio-app -> link removed, nothing created; user studio missing -> stays off;
# - listed -> user studioapp (uid/gid 907), group of studio, env file (password generated once), install of the pinned
#   commit (no tests/docs), owner copy, link; second run changes nothing; HS_CD_REF installs another commit;
# - --perms: the study folder is 3770 group studioapp, files 640, folders 2750, segnalazioni.md owned by the app 660,
#   ~studio 710; a link in place of segnalazioni.md is refused; the .claude of studio is never touched;
# - static: the run file drops privileges, only reads the study folder; Caddy, probe, cron, ports.
# Run from the repo root: device/edge/tests/studio-app.sh
set -eu
D=$PWD/device/edge/debian
S=$D/studio-app-setup
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin" "$t/sv" "$t/home/.secrets" "$t/src" "$t/sh/studio/programma" "$t/sh/.claude"
fail() { echo "FAIL: studio-app: $*"; cat "$t/out" 2>/dev/null; exit 1; }
echo "HS_USER=$(id -un)" > "$t/env"
# id: studio exists, studioapp after the useradd stub ran (flag file), with uid/gid 907.
cat > "$t/bin/id" <<EOS
#!/bin/sh
case "\$*" in
"studio"|"-nG studio") [ "\$1" = -nG ] && echo "studio \$(cat $t/groups 2>/dev/null)"; exit 0 ;;
"studioapp") [ -e $t/created ] ;;
"-u studioapp"|"-g studioapp") [ -e $t/created ] && echo 907 ;;
*) exec /usr/bin/id "\$@" ;;
esac
EOS
printf '#!/bin/sh\ntouch %s/created; echo "useradd $*" >> %s/log\n' "$t" "$t" > "$t/bin/useradd"
printf '#!/bin/sh\necho "groupadd $*" >> %s/log\n' "$t" > "$t/bin/groupadd"
printf '#!/bin/sh\necho studioapp > %s/groups; echo "usermod $*" >> %s/log\n' "$t" "$t" > "$t/bin/usermod"
# chown/chgrp: record only (the test user is not root); chmod is the real one.
printf '#!/bin/sh\necho "chown $*" >> %s/log\n' "$t" > "$t/bin/chown"
printf '#!/bin/sh\necho "chgrp $*" >> %s/log\n' "$t" > "$t/bin/chgrp"
printf '#!/bin/sh\necho "$*" >> %s/log\n' "$t" > "$t/bin/sv"
printf '#!/bin/sh\nargs=; while [ $# -gt 0 ]; do case $1 in -o|-g) shift 2 ;; *) args="$args $1"; shift ;; esac; done\nexec /usr/bin/install $args\n' > "$t/bin/install"
printf '#!/bin/sh\nshift 3; exec "$@"\n' > "$t/bin/runuser"
printf '#!/bin/sh\nwhile [ $# -gt 0 ]; do case $1 in --*) shift ;; *) break ;; esac; done\nexec "$@"\n' > "$t/bin/setpriv"
printf '#!/bin/sh\nexit 0\n' > "$t/bin/projects-git"
# getent: passwd studio -> the test studio home; passwd <hs user> -> the test home; uid 907 and group studioapp: free.
cat > "$t/bin/getent" <<EOS
#!/bin/sh
case "\$1 \$2" in
"passwd studio") echo "studio:x:906:906::$t/sh:/bin/bash" ;;
"passwd 907"|"group studioapp") exit 2 ;;
"passwd "*) echo "\$2:x:1:1::$t/home:/bin/sh" ;;
esac
EOS
printf '#!/bin/sh\necho "studio x studio-app active"\n' > "$t/gp-on"
printf '#!/bin/sh\necho "studio x - active"\n' > "$t/gp-off"
chmod 755 "$t"/bin/* "$t/gp-on" "$t/gp-off"
git -C "$t/src" init -q
mkdir "$t/src/test" "$t/src/docs" "$t/src/lib"; echo "console.log(1)" > "$t/src/server.js"; echo t > "$t/src/test/a.js"; echo d > "$t/src/docs/f.md"; echo '{}' > "$t/src/package.json"
git -C "$t/src" add -A; git -C "$t/src" -c user.name=t -c user.email=t@t commit -qm one
ref1=$(git -C "$t/src" rev-parse HEAD)
sed "s|^PIN_REF=[0-9a-f]*|PIN_REF=$ref1|" "$S" > "$t/setup"
run() { env PATH=$t/bin:$PATH HOME=$t/home HS_ENV_FILE=$t/env HS_STUDIO_APP_OPT=$t/opt HS_SERVICE_DIR=$t/sv HS_STUDIO_APP_BUILD=$t/build \
	HS_STUDIO_APP_ENV=$t/app.env HS_STUDIO_APP_STATE=$t/state HS_STUDIO_APP_SRC=$t/src HS_STUDIO_HOME=$t/sh HS_GATEWAY_PROJECTS=$1 HS_PROJECTS_GIT=$t/bin/projects-git sh "$t/setup" ${2:-} > "$t/out" 2>&1; }
# 1. not listed: an existing link goes, nothing is created.
ln -s /etc/hs-sv/studio-app "$t/sv/studio-app"
run "$t/gp-off" || fail "off run"
[ ! -e "$t/sv/studio-app" ] && [ ! -e "$t/opt" ] && [ ! -e "$t/app.env" ] && [ ! -e "$t/created" ] && grep -q disabled "$t/out" || fail "not disabled"
# 2. listed: user, env file, code, link.
run "$t/gp-on" || fail "on run"
[ -L "$t/sv/studio-app" ] && [ -f "$t/opt/server.js" ] && [ "$(cut -d' ' -f1 "$t/opt/REF")" = "$ref1" ] || fail "install"
[ ! -e "$t/opt/test" ] && [ ! -e "$t/opt/docs" ] && [ -f "$t/opt/package.json" ] || fail "runtime files only"
grep -q 'useradd .*nologin --uid 907 --gid 907' "$t/log" && grep -q 'groupadd --gid 907 studioapp' "$t/log" || fail "user/group 907 without login"
grep -q 'usermod -aG studioapp studio' "$t/log" || fail "studio not added to the group"
grep -q '^AUTH_USER=' "$t/app.env" && grep -q '^AUTH_PASSWORD=.\{32\}$' "$t/app.env" || fail "env file"
[ "$(cat "$t/home/.secrets/studio")" = "$(sed -n 's/^AUTH_PASSWORD=//p' "$t/app.env")" ] && [ "$(stat -c %a "$t/home/.secrets/studio")" = 600 ] || fail "owner copy"
grep -q 'chown root:studioapp' "$t/log" && [ "$(stat -c %a "$t/app.env")" = 640 ] || fail "env file mode/owner"
# login sessions state (issue 525): own folder 700, not under the study folder the tutor writes; the run file passes it.
[ -d "$t/state" ] && [ "$(stat -c %a "$t/state")" = 700 ] || fail "state folder missing or not 700"
case $t/state/ in "$t/sh/studio/"*) fail "state under the study folder" ;; esac
grep -q 'STATE_DIR=/var/lib/studio-app' "$D/sv/studio-app/run" && grep -q 'ST=${HS_STUDIO_APP_STATE:-/var/lib/studio-app}' "$S" || fail "state dir not wired"
# 3. second run: nothing changes.
pw=$(sed -n 's/^AUTH_PASSWORD=//p' "$t/app.env")
run "$t/gp-on" || fail "second run"
[ "$(sed -n 's/^AUTH_PASSWORD=//p' "$t/app.env")" = "$pw" ] && ! grep -q installed "$t/out" && ! grep -q 'created user' "$t/out" || fail "not idempotent"
# 4. HS_CD_REF installs another commit and restarts; a deploy never moves it back.
echo "console.log(2)" > "$t/src/server.js"; git -C "$t/src" -c user.name=t -c user.email=t@t commit -qam two
ref2=$(git -C "$t/src" rev-parse HEAD)
HS_CD_REF=$ref2 run "$t/gp-on" || fail "cd run"
grep -q 'console.log(2)' "$t/opt/server.js" && grep -q restart "$t/log" || fail "cd install"
run "$t/gp-on" || fail "deploy after cd"
[ "$(cut -d' ' -f1 "$t/opt/REF")" = "$ref2" ] || fail "deploy went back"
# 5. perms.
mkdir -p "$t/sh/studio/programma/sub"; echo p > "$t/sh/studio/programma/a.md"; echo c > "$t/sh/studio/CLAUDE.md"; echo s > "$t/sh/.claude/secret"
chmod 700 "$t/sh/.claude"; chmod 600 "$t/sh/studio/CLAUDE.md" "$t/sh/.claude/secret" "$t/sh/studio/programma/a.md"
chmod 755 "$t/sh/studio/programma" "$t/sh/studio/programma/sub" "$t/sh" "$t/sh/studio"
rm -f "$t/sh/studio/segnalazioni.md"
run "$t/gp-on" --perms || fail "perms run"
m() { stat -c %a "$1"; }
[ "$(m "$t/sh")" = 710 ] && [ "$(m "$t/sh/studio")" = 3770 ] || fail "modes of ~studio ($(m "$t/sh")) and the folder ($(m "$t/sh/studio"))"
[ "$(m "$t/sh/studio/CLAUDE.md")" = 640 ] && [ "$(m "$t/sh/studio/programma/a.md")" = 640 ] || fail "files not 640"
[ "$(m "$t/sh/studio/programma")" = 2750 ] && [ "$(m "$t/sh/studio/programma/sub")" = 2750 ] || fail "folders not 2750"
[ "$(m "$t/sh/studio/segnalazioni.md")" = 660 ] && grep -q 'chown studioapp:studioapp' "$t/log" || fail "segnalazioni.md not created 660 for the app"
chmod 755 "$t/sh/.claude"; run "$t/gp-on" --perms || fail "perms rerun"
[ "$(m "$t/sh/.claude")" = 700 ] && [ "$(m "$t/sh/.claude/secret")" = 600 ] || fail ".claude touched"
grep -q 'chgrp studioapp .*/\.claude' "$t/log" && fail ".claude regrouped" || true
# a link in place of segnalazioni.md is refused (never chown/chmod through it)
rm "$t/sh/studio/segnalazioni.md"; ln -s /etc/passwd "$t/sh/studio/segnalazioni.md"
! run "$t/gp-on" --perms && grep -q 'is a link' "$t/out" || fail "link accepted"
# user studio missing: stays off
rm "$t/sv/studio-app"; printf '#!/bin/sh\n[ "$1" = studio ] && exit 1\nexec /usr/bin/id "$@"\n' > "$t/bin/id"
run "$t/gp-on" || fail "no studio run"; [ ! -e "$t/sv/studio-app" ] && grep -q 'user studio missing' "$t/out" || fail "enabled without studio"

# 6. static: run file, Caddy, probe, cron, ports.
RUN=$D/sv/studio-app/run
for want in 'setpriv --reuid=studioapp' '--no-new-privs' '--bounding-set=-all' 'PORT=3008' 'LISTEN_HOST=127.0.0.1' 'STUDIO_DIR='; do grep -qF -- "$want" "$RUN" || fail "run lacks $want"; done
grep -q 'dangerously\|bypass' "$RUN" && fail "run: bypass"
grep -q 'APP_ID=907' "$S" || fail "uid 907"
grep -q "reverse_proxy 127.0.0.1:3008" "$D/Caddyfile" && grep -q '^https://{$HS_TS_HOST}:8449 {' "$D/Caddyfile" || fail "Caddy site 8449 -> 3008"
grep -q "svc: 'studio-app'.*127.0.0.1:3008" "$D/hs-monitor" || fail "probe"
grep -q '^studio | .* | studio-app | active' "$D/projects" || fail "projects row"
grep -q 'studio-app-setup --perms' "$D/cron.d-home-server" && grep -q 'studio-backup' "$D/backup-all" || fail "cron"
grep -q 'studio-app-setup' "$PWD/device/edge/deploy" && grep -q 'studio-backup' "$PWD/device/edge/deploy" || fail "deploy"
grep -q 'homelab/studio' "$D/rotate-secrets" || fail "rotate-secrets"
grep -q 'Segnalazioni dall.app' "$D/studio/CLAUDE.md" && grep -q 'umask 027' "$D/sv/studio/run" || fail "tutor rule / umask"
grep -q '^## Verifiche (verifiche.md)' "$D/studio/CLAUDE.md" && grep -q 'Verifiche (verifiche' "$D/studio-setup" || fail "tutor rule verifiche.md (462)"
grep -q "^## Calendario (calendario.md)" "$D/studio/CLAUDE.md" && grep -q "Calendario (calendario" "$D/studio-setup" || fail "tutor rule calendario.md (469)"
grep -q "^## Studio da solo" "$D/studio/CLAUDE.md" && grep -q "^## Nomi delle aree" "$D/studio/CLAUDE.md" && grep -q "Studio da solo" "$D/studio-setup" || fail "tutor rule fatto (498)"
echo "ok: studio-app"
