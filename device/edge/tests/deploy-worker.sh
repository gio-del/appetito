#!/bin/sh
# Test of the deploy with "Security enabled" (issue 512): `deploy` hands over to deploy-request when
# hs-security-enabled says true; deploy-worker deploys, verifies, and returns to the last good commit when
# the install or the verification fails. With false, deploy stays as before. Fake repo and fake deploy.
# From the repo root: device/edge/tests/deploy-worker.sh
set -eu
R=$(pwd); D=$R/device/edge/debian; fail=0
ok() { echo "ok   $1"; }; no() { echo "FAIL $1"; fail=1; }
t() { if grep -qF -- "$2" "$3"; then ok "$1"; else no "$1"; fi; }
t "deploy: true goes to deploy-request" 'exec "$HERE/deploy-request"' "$R/device/edge/deploy"
t "deploy: not when already the worker" 'HS_DEPLOY_WORKER:-}" ] && [ -f /etc/home-server.env ]' "$R/device/edge/deploy"
t "deploy: rollback skips checks" 'HS_DEPLOY_ROLLBACK' "$R/device/edge/deploy"
t "deploy: installs the worker" '"$D/deploy-worker"' "$R/device/edge/deploy"
t "deploy: enables the service when true" 'hs-sv/deploy-worker /etc/hs-service/deploy-worker' "$R/device/edge/deploy"
t "sv run: worker without no-new-privs" 'setpriv --reuid="$HS_USER" --regid="$HS_USER" --init-groups /usr/local/sbin/deploy-worker' "$D/sv/deploy-worker/run"

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HS_DEPLOY_DIR=$T/d HS_DEPLOY_REPO=$T/repo HS_DEPLOY_STATE=$T/state HS_DEPLOY_SETTLE=0 HS_DEPLOY_ONCE=1 HS_DEPLOY_WAIT=20 HOME=$T
mkdir -p "$T/d" "$T/repo/device/edge" "$T/state" "$T/bin"
cat > "$T/bin/sudo" <<'X'
#!/bin/sh
exit 0
X
cat > "$T/bin/hs-notify" <<X
#!/bin/sh
echo "\$*" >> $T/notified
X
chmod +x "$T/bin/sudo" "$T/bin/hs-notify"; PATH=$T/bin:$PATH
# fake deploy: records the version it deploys; fails install when the marker file says so
cat > "$T/repo/device/edge/deploy" <<X
#!/bin/sh
here=\$(cd "\$(dirname "\$0")" && pwd)
echo "deploying \$(cat "\$here/VERSION")" >> $T/deployed
[ -e $T/fail-install ] && [ "\$(cat "\$here/VERSION")" = bad ] && { echo "\$(date '+%F %T') failed install: other" >> $T/state/deploy.log; exit 1; }
echo "\$(date '+%F %T') ok" >> $T/state/deploy.log; exit 0
X
chmod +x "$T/repo/device/edge/deploy"; touch "$T/repo/device/edge/home-server.env"
git -C "$T/repo" init -q; git -C "$T/repo" config user.email t@t; git -C "$T/repo" config user.name t
echo good > "$T/repo/device/edge/VERSION"; git -C "$T/repo" add -A; git -C "$T/repo" commit -qm one
good=$(git -C "$T/repo" rev-parse HEAD)
req() { sh "$R/device/edge/deploy-request" "$@" > "$T/req.out" 2>&1 & rp=$!; sh "$D/deploy-worker" & wp=$!; rc=0; wait $rp || rc=$?; wait $wp || true; }
touch "$T/d/alive"

# 1. good deploy: ok, version recorded
HS_DEPLOY_VERIFY=true req
[ "$rc" = 0 ] && ok "good deploy: rc 0" || no "good deploy: rc $rc"
[ "$(cat "$T/state/deploy-good")" = "$good" ] && ok "good deploy: version recorded" || no "good deploy: version not recorded"

# 2. verification fails: rolls back to the good commit, rc 1, owner told
echo bad > "$T/repo/device/edge/VERSION"; git -C "$T/repo" commit -qam two; : > "$T/deployed"
HS_DEPLOY_VERIFY=false req
[ "$rc" = 1 ] && ok "failed verify: rc 1" || no "failed verify: rc $rc"
[ "$(tr '\n' ' ' < "$T/deployed")" = "deploying bad deploying good " ] && ok "failed verify: redeployed the good version" || no "failed verify: deployed $(cat "$T/deployed")"
[ -s "$T/notified" ] && ok "failed verify: owner notified" || no "failed verify: no notification"
[ "$(cat "$T/state/deploy-good")" = "$good" ] && ok "failed verify: good version unchanged" || no "failed verify: good version moved"

# 3. install fails: rolls back too
: > "$T/deployed"; touch "$T/fail-install"
HS_DEPLOY_VERIFY=true req
[ "$rc" = 1 ] && ok "failed install: rc 1" || no "failed install: rc $rc"
[ "$(tr '\n' ' ' < "$T/deployed")" = "deploying bad deploying good " ] && ok "failed install: redeployed the good version" || no "failed install: deployed $(cat "$T/deployed")"
rm -f "$T/fail-install"

# 4. a failure of the checks (nothing installed): no rollback
cat > "$T/repo/device/edge/deploy" <<X
#!/bin/sh
echo "\$(date '+%F %T') failed check: syntax" >> $T/state/deploy.log; exit 1
X
: > "$T/deployed"; HS_DEPLOY_VERIFY=true req
[ "$rc" = 1 ] && ok "failed check: rc 1" || no "failed check: rc $rc"
[ ! -s "$T/deployed" ] && ok "failed check: no rollback" || no "failed check: rolled back"

# 5. no worker: the request side says so; refused argument
rm -f "$T/d/alive"
if sh "$R/device/edge/deploy-request" > "$T/req.out" 2>&1; then no "no worker: should fail"; else ok "no worker: fails at once"; fi
exit $fail
