#!/bin/sh
# Test of debian/library-setup (issue 194) with stubs for the root-only commands: not listed with the
# service -> link removed; listed -> user, env file (password generated once), install of the pinned
# commit, link; a second run changes nothing; a new PIN_REF replaces the code.
# Run from the repo root: device/edge/tests/library-setup.sh
set -eu
S=$PWD/device/edge/debian/library-setup
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin" "$t/sv" "$t/home/.secrets" "$t/src"
fail() { echo "FAIL: library-setup: $*"; cat "$t/out" 2>/dev/null; exit 1; }
echo "HS_USER=$(id -un)" > "$t/env"
printf '#!/bin/sh\nexit 1\n' > "$t/bin/id"
printf '#!/bin/sh\necho "$*" >> %s/log\n' "$t" > "$t/bin/useradd"
printf '#!/bin/sh\nexit 0\n' > "$t/bin/chown"
printf '#!/bin/sh\necho "$*" >> %s/log\n' "$t" > "$t/bin/sv"
# install without -o/-g (the test user does not exist); runuser -u USER -- CMD: just CMD.
printf '#!/bin/sh\nargs=; while [ $# -gt 0 ]; do case $1 in -o|-g) shift 2 ;; *) args="$args $1"; shift ;; esac; done\nexec /usr/bin/install $args\n' > "$t/bin/install"
printf '#!/bin/sh\nshift 3; exec "$@"\n' > "$t/bin/runuser"
# setpriv: drop its options (--reuid=… --no-new-privs …) and run the command as the test user.
printf '#!/bin/sh\nwhile [ $# -gt 0 ]; do case $1 in --*) shift ;; *) break ;; esac; done\nexec "$@"\n' > "$t/bin/setpriv"
# npm: `npm ci` ok, `npm run build` writes ../public/index.html like Vite (fails when $t/npm-fail exists).
printf '#!/bin/sh\n[ "$1" = ci ] && exit 0\n[ ! -e %s/npm-fail ] || exit 1\nmkdir -p ../public && echo built > ../public/index.html\n' "$t" > "$t/bin/npm"
printf '#!/bin/sh\nexit 0\n' > "$t/bin/projects-git"
printf '#!/bin/sh\necho "$*" >> %s/log\n' "$t" > "$t/bin/usermod"
# curl: the Claude installer, which puts an executable claude in $HOME/.local/bin.
printf '#!/bin/sh\necho "mkdir -p \$HOME/.local/bin; echo claude > \$HOME/.local/bin/claude; chmod 755 \$HOME/.local/bin/claude"\n' > "$t/bin/curl"
printf '#!/bin/sh\necho "library x library active"\n' > "$t/gp-on"
printf '#!/bin/sh\necho "library x - active"\n' > "$t/gp-off"
chmod 755 "$t"/bin/* "$t/gp-on" "$t/gp-off"
git -C "$t/src" init -q
mkdir "$t/src/test"; echo "console.log(1)" > "$t/src/server.js"; echo t > "$t/src/test/a.js"
git -C "$t/src" add -A; git -C "$t/src" -c user.name=t -c user.email=t@t commit -qm one
ref1=$(git -C "$t/src" rev-parse HEAD)
sed "s|^PIN_REF=[0-9a-f]*|PIN_REF=$ref1|" "$S" > "$t/setup"
run() { env PATH=$t/bin:$PATH HOME=$t/home HS_ENV_FILE=$t/env HS_LIBRARY_DATA=$t/data HS_LIBRARY_OPT=$t/opt HS_SERVICE_DIR=$t/sv \
	HS_LIBRARY_BUILD_PATH=$t/bin:/usr/bin:/bin HS_LIBRARY_ENV=$t/lib.env HS_LIBRARY_SRC=$t/src HS_GATEWAY_PROJECTS=$1 HS_PROJECTS_GIT=$t/bin/projects-git sh "$t/setup" > "$t/out" 2>&1; }
# 1. not listed with the service: an existing link goes, nothing is created.
ln -s /etc/hs-sv/library "$t/sv/library"
run "$t/gp-off" || fail "off run"
[ ! -e "$t/sv/library" ] && [ ! -e "$t/opt" ] && [ ! -e "$t/lib.env" ] && grep -q disabled "$t/out" || fail "not disabled"
# 2. listed: user, env file, code, link.
# getent passwd of the test user gives the real home: the owner copy goes to $OH/.secrets, so point it at the test home.
printf '#!/bin/sh\necho "$2:x:1:1::%s:/bin/sh"\n' "$t/home" > "$t/bin/getent"; chmod 755 "$t/bin/getent"
run "$t/gp-on" || fail "on run"
[ -L "$t/sv/library" ] && [ -f "$t/opt/server.js" ] && [ ! -e "$t/opt/test" ] && [ "$(cut -d' ' -f1 "$t/opt/REF")" = "$ref1" ] || fail "install"
grep -q '^AUTH_USER=' "$t/lib.env" && grep -q '^AUTH_PASSWORD=.\{32\}$' "$t/lib.env" || fail "env file"
[ "$(cat "$t/home/.secrets/library")" = "$(sed -n 's/^AUTH_PASSWORD=//p' "$t/lib.env")" ] || fail "owner copy"
[ "$(stat -c %a "$t/home/.secrets/library")" = 600 ] && [ "$(stat -c %a "$t/data")" = 700 ] || fail "modes"
grep -q "shell /bin/bash library" "$t/log" && grep -q "CLAUDE_CODE_TMPDIR" "$t/data/.profile" && grep -q "local/bin" "$t/data/.profile" && [ -x "$t/data/.local/bin/claude" ] || fail "claude for library"
# 3. second run: nothing changes (same password, no install).
pw=$(sed -n 's/^AUTH_PASSWORD=//p' "$t/lib.env")
run "$t/gp-on" || fail "second run"
[ "$(sed -n 's/^AUTH_PASSWORD=//p' "$t/lib.env")" = "$pw" ] && ! grep -q installed "$t/out" || fail "not idempotent"
# 4. a new pinned commit replaces the code and restarts the service.
echo "console.log(2)" > "$t/src/server.js"; git -C "$t/src" -c user.name=t -c user.email=t@t commit -qam two
ref2=$(git -C "$t/src" rev-parse HEAD)
sed -i "s|^PIN_REF=[0-9a-f]*|PIN_REF=$ref2|" "$t/setup"
run "$t/gp-on" || fail "upgrade run"
grep -q 'console.log(2)' "$t/opt/server.js" && [ "$(cut -d' ' -f1 "$t/opt/REF")" = "$ref2" ] && grep -q "restart" "$t/log" || fail "upgrade"
# 4b. a deploy never moves the app back (issue 235): PIN_REF older than the installed commit changes nothing;
# project-cd's HS_CD_REF installs any commit (rollback) and back.
sed -i "s|^PIN_REF=[0-9a-f]*|PIN_REF=$ref1|" "$t/setup"
run "$t/gp-on" || fail "older pin run"
[ "$(cut -d' ' -f1 "$t/opt/REF")" = "$ref2" ] || fail "deploy went back"
HS_CD_REF=$ref1 run "$t/gp-on" || fail "rollback run"
[ "$(cut -d' ' -f1 "$t/opt/REF")" = "$ref1" ] || fail "HS_CD_REF not installed"
HS_CD_REF=$ref2 run "$t/gp-on" || fail "forward run"
[ "$(cut -d' ' -f1 "$t/opt/REF")" = "$ref2" ] || fail "HS_CD_REF forward"
sed -i "s|^PIN_REF=[0-9a-f]*|PIN_REF=$ref2|" "$t/setup"
# 5. a commit without server.js is refused and the installed code stays.
git -C "$t/src" rm -q server.js; git -C "$t/src" -c user.name=t -c user.email=t@t commit -qm three
sed -i "s|^PIN_REF=[0-9a-f]*|PIN_REF=$(git -C "$t/src" rev-parse HEAD)|" "$t/setup"
! run "$t/gp-on" && grep -q 'console.log(2)' "$t/opt/server.js" || fail "bad commit accepted"
# 6. a commit with frontend/ is built as user library and only the runtime files are installed (issue 281);
# a failing build keeps the installed code.
git -C "$t/src" checkout -q "$ref2" -- server.js
mkdir -p "$t/src/frontend/src" "$t/src/lib"; echo '{}' > "$t/src/frontend/package.json"; echo x > "$t/src/frontend/src/a.tsx"; echo 'module.exports=1' > "$t/src/lib/x.js"
git -C "$t/src" add -A; git -C "$t/src" -c user.name=t -c user.email=t@t commit -qm four
ref4=$(git -C "$t/src" rev-parse HEAD)
touch "$t/npm-fail"
! HS_CD_REF=$ref4 run "$t/gp-on" && grep -q "build of $ref4 failed" "$t/out" && [ "$(cut -d' ' -f1 "$t/opt/REF")" = "$ref2" ] || fail "failed build accepted"
rm "$t/npm-fail"
HS_CD_REF=$ref4 run "$t/gp-on" || fail "frontend run"
[ "$(cut -d' ' -f1 "$t/opt/REF")" = "$ref4" ] && [ "$(cat "$t/opt/public/index.html")" = built ] && [ -f "$t/opt/lib/x.js" ] && [ -f "$t/opt/server.js" ] || fail "frontend install"
[ ! -e "$t/opt/frontend" ] && [ ! -e "$t/opt/node_modules" ] && [ ! -e "$t/opt/test" ] && [ ! -e "$t/data/build/src" ] || fail "build leftovers in the install"
echo "ok: library-setup"
